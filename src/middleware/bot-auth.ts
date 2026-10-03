import { createMiddleware } from 'hono/factory';
import type { Bindings } from '../env';
import { isValidBotToken } from '../lib/bot-token';

/**
 * Requires an X-Bot-Token header equal to BOT_API_KEY (compared in constant
 * time); rejects with 403 otherwise. Fails closed: when BOT_API_KEY is not
 * configured every request is rejected with 503 BOT_AUTH_NOT_CONFIGURED, so a
 * deploy that forgot the secret cannot be used to mint logins. Set the key with
 * `wrangler secret put BOT_API_KEY` (production) or in .dev.vars (local).
 */
export const requireBotAuth = createMiddleware<{ Bindings: Bindings }>(async (c, next) => {
	const key = c.env.BOT_API_KEY;
	if (!key) {
		return c.json(
			{ ok: false, error: { code: 'BOT_AUTH_NOT_CONFIGURED', message: 'Bot authentication is not configured on this server (BOT_API_KEY is not set)' } },
			503,
		);
	}

	if (!isValidBotToken(key, c.req.header('X-Bot-Token'))) {
		return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Invalid bot token' } }, 403);
	}

	await next();
});
