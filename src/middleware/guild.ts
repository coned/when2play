import { createMiddleware } from 'hono/factory';
import { getCookie } from 'hono/cookie';
import type { Bindings } from '../env';

export const guildDb = createMiddleware<{ Bindings: Bindings }>(async (c, next) => {
	// Defensive copy: Workers share the env object across requests in the
	// same isolate. Without this, setting c.env.DB for one guild pollutes
	// subsequent requests for other guilds.
	c.env = { ...c.env } as Bindings;

	const isBotAuth =
		!!c.env.BOT_API_KEY &&
		c.req.header('X-Bot-Token') === c.env.BOT_API_KEY;

	const guildId = isBotAuth
		? c.req.header('X-Guild-Id')
		: (c.req.query('guild') || getCookie(c, 'guild_id'));

	if (!guildId) {
		return c.json({ ok: false, error: { code: 'MISSING_GUILD', message: 'No guild context' } }, 400);
	}

	if (!/^\d{17,20}$/.test(guildId)) {
		return c.json({ ok: false, error: { code: 'INVALID_GUILD', message: 'Invalid guild ID format' } }, 400);
	}

	const db = c.env[`DB_${guildId}`];
	if (db) {
		c.env.DB = db;
	} else if (!c.env.DB) {
		return c.json({ ok: false, error: { code: 'UNKNOWN_GUILD', message: 'No DB binding for guild' } }, 404);
	}
	// If no guild-specific binding but c.env.DB exists, fall through (default DB)

	await next();
});
