import { Hono } from 'hono';
import type { Bindings } from '../env';
import { requireAuth } from '../middleware/auth';
import { updateUser, type UserRow } from '../db/queries/users';

type UsersEnv = {
	Bindings: Bindings;
	Variables: {
		user: UserRow;
		sessionId: string;
	};
};

const users = new Hono<UsersEnv>();

users.use('/*', requireAuth);

// GET /api/users/me
users.get('/me', (c) => {
	const user = c.get('user');
	return c.json({ ok: true, data: user });
});

// PATCH /api/users/me
users.patch('/me', async (c) => {
	const user = c.get('user');
	const body = await c.req.json<{ discord_username?: string; timezone?: string; time_granularity_minutes?: number }>();

	if (body.time_granularity_minutes !== undefined && (body.time_granularity_minutes < 5 || body.time_granularity_minutes > 60)) {
		return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'time_granularity_minutes must be between 5 and 60' } }, 400);
	}

	const updated = await updateUser(c.env.DB, user.id, body);
	return c.json({ ok: true, data: updated });
});

export default users;
