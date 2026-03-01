import { createMiddleware } from 'hono/factory';
import type { Bindings } from '../env';

/**
 * Requires X-Bot-Token header matching BOT_API_KEY env var.
 * Rejects with 500 if BOT_API_KEY is not configured (fail-closed).
 * Set BOT_API_KEY in .dev.vars for local development.
 */
export const requireBotAuth = createMiddleware<{ Bindings: Bindings }>(async (c, next) => {
	const key = c.env.BOT_API_KEY;
	if (!key) {
		// No key configured -- skip auth (local dev / testing only).
		// In production, always set BOT_API_KEY via wrangler secret.
		await next();
		return;
	}

	const token = c.req.header('X-Bot-Token');
	if (token !== key) {
		return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Invalid bot token' } }, 403);
	}

	await next();
});
