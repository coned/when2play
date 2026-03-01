import { createMiddleware } from 'hono/factory';
import { getCookie } from 'hono/cookie';
import type { Bindings } from '../env';

export const guildDb = createMiddleware<{ Bindings: Bindings }>(async (c, next) => {
	// Only trust X-Guild-Id from bot-authenticated requests.
	// Browsers can set arbitrary headers via fetch(), so unauthenticated
	// requests must use the guild_id cookie or guild query param instead.
	const isBotAuth =
		!!c.env.BOT_API_KEY &&
		c.req.header('X-Bot-Token') === c.env.BOT_API_KEY;

	const guildId = isBotAuth
		? c.req.header('X-Guild-Id')
		: (c.req.query('guild') || getCookie(c, 'guild_id'));

	if (!guildId) {
		return c.json({ ok: false, error: { code: 'MISSING_GUILD', message: 'No guild context' } }, 400);
	}

	// Validate format: Discord snowflakes are numeric strings, 17-20 digits.
	if (!/^\d{17,20}$/.test(guildId)) {
		return c.json({ ok: false, error: { code: 'INVALID_GUILD', message: 'Invalid guild ID format' } }, 400);
	}

	const bindingKey = `DB_${guildId}` as const;
	const db = c.env[bindingKey];

	if (!db) {
		// Fall back to default DB if no guild-specific binding exists.
		// This supports the initial single-guild setup where only `DB` is configured.
		if (c.env.DB) {
			await next();
			return;
		}
		return c.json({ ok: false, error: { code: 'UNKNOWN_GUILD', message: 'No DB binding for guild' } }, 404);
	}

	c.env.DB = db;
	await next();
});
