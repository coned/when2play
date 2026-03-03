import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import type { Bindings } from '../env';
import type { UserRow } from '../db/queries/users';
import { requireAuth } from '../middleware/auth';
import { generateSessionId } from '../lib/crypto';
import { createSession } from '../db/queries/auth';
import { getSetting } from '../db/queries/settings';

type GuildsEnv = {
	Bindings: Bindings;
	Variables: {
		user: UserRow;
		sessionId: string;
		isAdmin: boolean;
	};
};

const guilds = new Hono<GuildsEnv>();

/** Extract all DB_<snowflake> binding keys from env */
function getGuildBindingKeys(env: Bindings): Array<{ guildId: string; db: D1Database }> {
	const result: Array<{ guildId: string; db: D1Database }> = [];
	for (const key of Object.keys(env)) {
		const match = key.match(/^DB_(\d{17,20})$/);
		if (match) {
			result.push({ guildId: match[1], db: env[key as `DB_${string}`] });
		}
	}
	return result;
}

// GET /guilds/mine - list guilds the current user belongs to
guilds.get('/mine', requireAuth, async (c) => {
	const user = c.get('user');
	const discordId = user.discord_id;
	const currentGuildId = getCookie(c, 'guild_id') ?? null;

	const bindings = getGuildBindingKeys(c.env);

	const checks = bindings.map(async ({ guildId, db }) => {
		try {
			const row = await db
				.prepare('SELECT id FROM users WHERE discord_id = ?')
				.bind(discordId)
				.first<{ id: string }>();
			if (!row) return null;

			const guildName = await getSetting(db, 'guild_name');
			return {
				guild_id: guildId,
				guild_name: typeof guildName === 'string' ? guildName : null,
			};
		} catch {
			return null;
		}
	});

	const results = await Promise.all(checks);
	const userGuilds = results.filter((g): g is NonNullable<typeof g> => g !== null);

	return c.json({
		ok: true,
		data: {
			guilds: userGuilds,
			current_guild_id: currentGuildId,
		},
	});
});

// POST /guilds/switch - switch to a different guild
guilds.post('/switch', requireAuth, async (c) => {
	const user = c.get('user');
	const discordId = user.discord_id;

	const body = await c.req.json().catch(() => null);
	if (!body || typeof body.guild_id !== 'string') {
		return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Missing guild_id' } }, 400);
	}

	const targetGuildId: string = body.guild_id;
	if (!/^\d{17,20}$/.test(targetGuildId)) {
		return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Invalid guild_id format' } }, 400);
	}

	const targetDb = c.env[`DB_${targetGuildId}`];
	if (!targetDb) {
		return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Guild not found' } }, 404);
	}

	// Verify the user exists in the target guild
	const targetUser = await targetDb
		.prepare('SELECT id FROM users WHERE discord_id = ?')
		.bind(discordId)
		.first<{ id: string }>();

	if (!targetUser) {
		return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'You are not registered in that guild' } }, 403);
	}

	// Create a new session in the target guild's DB
	const sessionId = generateSessionId();
	await createSession(targetDb, targetUser.id, sessionId);

	const isProduction = new URL(c.req.url).protocol === 'https:';
	const cookieOptions = {
		httpOnly: true,
		sameSite: 'Strict' as const,
		path: '/',
		secure: isProduction,
		maxAge: 7 * 24 * 60 * 60,
	};

	setCookie(c, 'guild_id', targetGuildId, cookieOptions);
	setCookie(c, 'session_id', sessionId, cookieOptions);

	return c.json({ ok: true, data: null });
});

export default guilds;
