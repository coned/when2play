import { createMiddleware } from 'hono/factory';
import type { Bindings } from '../env';

/**
 * Requires X-Bot-Token header matching BOT_API_KEY env var.
 * Skips check if BOT_API_KEY is not set (local dev).
 */
export const requireBotAuth = createMiddleware<{ Bindings: Bindings }>(async (c, next) => {
	const key = c.env.BOT_API_KEY;
	if (!key) {
		await next();
		return;
	}

	const token = c.req.header('X-Bot-Token');
	if (token !== key) {
		return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Invalid bot token' } }, 403);
	}

	await next();
});
