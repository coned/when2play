import { Hono } from 'hono';
import { setCookie, deleteCookie } from 'hono/cookie';
import { z } from 'zod';
import type { Bindings } from '../env';
import { generateToken, generateSessionId } from '../lib/crypto';
import { upsertUser } from '../db/queries/users';
import { createAuthToken, consumeAuthToken, createSession, deleteSession } from '../db/queries/auth';
import { requireAuth } from '../middleware/auth';
import { requireBotAuth } from '../middleware/bot-auth';
import { updateSettings } from '../db/queries/settings';
import type { UserRow } from '../db/queries/users';

type AuthEnv = {
	Bindings: Bindings;
	Variables: {
		user: UserRow;
		sessionId: string;
		isAdmin: boolean;
	};
};

const createTokenSchema = z.object({
	discord_id: z.string().min(1).max(30),
	discord_username: z.string().min(1).max(50),
	avatar_url: z.string().max(500).optional(),
	guild_name: z.string().max(100).optional(),
});

const auth = new Hono<AuthEnv>();

// POST /api/auth/token — Bot creates a one-time auth token for a Discord user
auth.post('/token', requireBotAuth, async (c) => {
	const raw = await c.req.json().catch(() => null);
	const parsed = createTokenSchema.safeParse(raw);

	if (!parsed.success) {
		return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid request body' } }, 400);
	}

	const { discord_id, discord_username, avatar_url, guild_name } = parsed.data;
	const user = await upsertUser(c.env.DB, discord_id, discord_username, avatar_url);
	const token = generateToken();
	await createAuthToken(c.env.DB, user.id, token);

	if (guild_name) {
		await updateSettings(c.env.DB, { guild_name });
	}

	const url = new URL(c.req.url);
	const guildId = c.req.header('X-Guild-Id');
	const authUrl = `${url.protocol}//${url.host}/auth/${token}${guildId ? `?guild=${guildId}` : ''}`;

	return c.json({ ok: true, data: { token, url: authUrl } }, 201);
});

// POST /api/auth/admin-token — Bot creates a one-time admin auth token (Discord ADMINISTRATOR permission gated at bot)
auth.post('/admin-token', requireBotAuth, async (c) => {
	const raw = await c.req.json().catch(() => null);
	const parsed = createTokenSchema.safeParse(raw);

	if (!parsed.success) {
		return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid request body' } }, 400);
	}

	// Per-guild admin account prevents cross-guild access via guild switcher
	const guildId = c.req.header('X-Guild-Id');
	if (!guildId || !/^\d{17,20}$/.test(guildId)) {
		return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Missing guild context' } }, 400);
	}
	const adminDiscordId = `system-admin-${guildId}`;

	// Migrate legacy shared "system-admin" row to scoped ID.
	// Transfer FK refs from scoped row to old row, delete scoped, rename old.
	// rallies/rally_actions/rally_tree_shares lack ON DELETE CASCADE.
	const oldUser = await c.env.DB.prepare(
		'SELECT id FROM users WHERE discord_id = ?'
	).bind('system-admin').first<{ id: string }>();
	if (oldUser) {
		const scopedUser = await c.env.DB.prepare(
			'SELECT id FROM users WHERE discord_id = ?'
		).bind(adminDiscordId).first<{ id: string }>();
		if (scopedUser) {
			await c.env.DB.batch([
				c.env.DB.prepare('UPDATE rallies SET creator_id = ? WHERE creator_id = ?').bind(oldUser.id, scopedUser.id),
				c.env.DB.prepare('UPDATE rally_actions SET actor_id = ? WHERE actor_id = ?').bind(oldUser.id, scopedUser.id),
				c.env.DB.prepare('UPDATE rally_tree_shares SET requested_by = ? WHERE requested_by = ?').bind(oldUser.id, scopedUser.id),
				c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(scopedUser.id),
				c.env.DB.prepare('UPDATE users SET discord_id = ? WHERE id = ?').bind(adminDiscordId, oldUser.id),
			]);
		} else {
			await c.env.DB.prepare(
				'UPDATE users SET discord_id = ? WHERE discord_id = ?'
			).bind(adminDiscordId, 'system-admin').run();
		}
	}

	const user = await upsertUser(c.env.DB, adminDiscordId, 'Administrator', null);
	const token = generateToken();
	await createAuthToken(c.env.DB, user.id, token, true);

	if (parsed.data.guild_name) {
		await updateSettings(c.env.DB, { guild_name: parsed.data.guild_name });
	}

	const url = new URL(c.req.url);
	const authUrl = `${url.protocol}//${url.host}/auth/${token}${guildId ? `?guild=${guildId}` : ''}`;

	return c.json({ ok: true, data: { token, url: authUrl } }, 201);
});

// GET /api/auth/callback/:token — Exchange one-time token for session cookie
auth.get('/callback/:token', async (c) => {
	c.header('Cache-Control', 'no-store');

	const token = c.req.param('token');
	const authToken = await consumeAuthToken(c.env.DB, token);

	if (!authToken) {
		return c.json({
			ok: false,
			error: { code: 'INVALID_TOKEN', message: 'Token is invalid, expired, or already used' },
		}, 401);
	}

	const isAdmin = Boolean(authToken.is_admin);
	const sessionId = generateSessionId();
	await createSession(c.env.DB, authToken.user_id, sessionId, isAdmin);

	// Bot calls: return JSON with user + session instead of cookie + redirect
	const botToken = c.req.header('X-Bot-Token');
	if (botToken && botToken === c.env.BOT_API_KEY) {
		const user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(authToken.user_id).first();
		return c.json({ ok: true, data: { user, session: { session_id: sessionId } } });
	}

	const isProduction = new URL(c.req.url).protocol === 'https:';
	const cookieOptions = {
		httpOnly: true,
		sameSite: 'Strict' as const,
		path: '/',
		secure: isProduction,
		...(isAdmin ? {} : { maxAge: 7 * 24 * 60 * 60 }),
	};
	const guildId = c.req.query('guild');
	if (guildId) {
		setCookie(c, 'guild_id', guildId, cookieOptions);
	}
	setCookie(c, 'session_id', sessionId, cookieOptions);

	return c.redirect('/');
});

// POST /api/auth/logout — Destroy session
auth.post('/logout', requireAuth, async (c) => {
	const sessionId = c.get('sessionId');
	await deleteSession(c.env.DB, sessionId);
	deleteCookie(c, 'session_id', { path: '/' });
	deleteCookie(c, 'guild_id', { path: '/' });
	return c.json({ ok: true, data: null });
});

export default auth;
