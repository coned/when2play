import { createMiddleware } from 'hono/factory';
import { getCookie } from 'hono/cookie';
import type { Bindings } from '../env';
import { getSessionBySessionId } from '../db/queries/auth';
import { getUserById, getUserByDiscordId, type UserRow } from '../db/queries/users';

type AuthEnv = {
	Bindings: Bindings;
	Variables: {
		user: UserRow;
		sessionId: string;
		isAdmin: boolean;
	};
};

/**
 * Authenticates a user request, either by session cookie or, for the Discord
 * bot, by acting as a user: X-Bot-Token equal to BOT_API_KEY plus
 * X-Discord-User-Id names the user (by discord_id) in the guild database. The
 * act-as path never exists when BOT_API_KEY is unset, and a request whose
 * token does not match is handled like any cookie request. Act-as requests
 * are never admin and have no session (sessionId is '').
 */
export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
	const botKey = c.env.BOT_API_KEY;
	const actAsDiscordId = c.req.header('X-Discord-User-Id');
	if (botKey && actAsDiscordId !== undefined && c.req.header('X-Bot-Token') === botKey) {
		const user = actAsDiscordId && actAsDiscordId.length <= 30 ? await getUserByDiscordId(c.env.DB, actAsDiscordId) : null;
		if (!user) {
			return c.json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Unknown Discord user for this server' } }, 401);
		}
		c.set('user', user);
		c.set('sessionId', '');
		c.set('isAdmin', false);
		await next();
		return;
	}

	const sessionId = getCookie(c, 'session_id');
	if (!sessionId) {
		return c.json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'No session cookie' } }, 401);
	}

	const session = await getSessionBySessionId(c.env.DB, sessionId);
	if (!session) {
		return c.json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Invalid or expired session' } }, 401);
	}

	const user = await getUserById(c.env.DB, session.user_id);
	if (!user) {
		return c.json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'User not found' } }, 401);
	}

	c.set('user', user);
	c.set('sessionId', sessionId);
	c.set('isAdmin', Boolean(session.is_admin));
	await next();
});
