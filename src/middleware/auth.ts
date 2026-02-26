import { createMiddleware } from 'hono/factory';
import { getCookie } from 'hono/cookie';
import type { Bindings } from '../env';
import { getSessionBySessionId } from '../db/queries/auth';
import { getUserById, type UserRow } from '../db/queries/users';

type AuthEnv = {
	Bindings: Bindings;
	Variables: {
		user: UserRow;
		sessionId: string;
	};
};

export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
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
	await next();
});
