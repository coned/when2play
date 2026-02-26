import { Hono } from 'hono';
import { setCookie, deleteCookie } from 'hono/cookie';
import type { Bindings } from '../env';
import { generateToken, generateSessionId } from '../lib/crypto';
import { upsertUser } from '../db/queries/users';
import { createAuthToken, consumeAuthToken, createSession, deleteSession } from '../db/queries/auth';
import { requireAuth } from '../middleware/auth';
import type { UserRow } from '../db/queries/users';

type AuthEnv = {
	Bindings: Bindings;
	Variables: {
		user: UserRow;
		sessionId: string;
	};
};

const auth = new Hono<AuthEnv>();

// POST /api/auth/token — Bot creates a one-time auth token for a Discord user
auth.post('/token', async (c) => {
	const body = await c.req.json<{ discord_id: string; discord_username: string; avatar_url?: string }>();

	if (!body.discord_id || !body.discord_username) {
		return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'discord_id and discord_username required' } }, 400);
	}

	const user = await upsertUser(c.env.DB, body.discord_id, body.discord_username, body.avatar_url);
	const token = generateToken();
	await createAuthToken(c.env.DB, user.id, token);

	const url = new URL(c.req.url);
	const authUrl = `${url.protocol}//${url.host}/auth/${token}`;

	return c.json({ ok: true, data: { token, url: authUrl } }, 201);
});

// GET /api/auth/callback/:token — Exchange one-time token for session cookie
auth.get('/callback/:token', async (c) => {
	const token = c.req.param('token');
	const authToken = await consumeAuthToken(c.env.DB, token);

	if (!authToken) {
		return c.json({ ok: false, error: { code: 'INVALID_TOKEN', message: 'Token is invalid, expired, or already used' } }, 401);
	}

	const sessionId = generateSessionId();
	await createSession(c.env.DB, authToken.user_id, sessionId);

	const isProduction = new URL(c.req.url).protocol === 'https:';
	setCookie(c, 'session_id', sessionId, {
		httpOnly: true,
		sameSite: 'Lax',
		path: '/',
		secure: isProduction,
		maxAge: 7 * 24 * 60 * 60,
	});

	return c.redirect('/');
});

// POST /api/auth/logout — Destroy session
auth.post('/logout', requireAuth, async (c) => {
	const sessionId = c.get('sessionId');
	await deleteSession(c.env.DB, sessionId);
	deleteCookie(c, 'session_id', { path: '/' });
	return c.json({ ok: true, data: null });
});

export default auth;
