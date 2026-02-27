import { Hono } from 'hono';
import type { Bindings } from '../env';
import { requireAuth } from '../middleware/auth';
import { updateUser, getAllUsers, type UserRow } from '../db/queries/users';

type UsersEnv = {
	Bindings: Bindings;
	Variables: {
		user: UserRow;
		sessionId: string;
		isAdmin: boolean;
	};
};

const users = new Hono<UsersEnv>();

users.use('/*', requireAuth);

// GET /api/users — list all users (id, username, display_name, avatar)
users.get('/', async (c) => {
	const allUsers = await getAllUsers(c.env.DB);
	return c.json({ ok: true, data: allUsers });
});

// GET /api/users/me
users.get('/me', (c) => {
	const user = c.get('user');
	return c.json({ ok: true, data: { ...user, is_admin: c.get('isAdmin') } });
});

// PATCH /api/users/me
users.patch('/me', async (c) => {
	const user = c.get('user');
	const body = await c.req.json<{
		discord_username?: string;
		display_name?: string;
		sync_name_from_discord?: boolean;
		timezone?: string;
		time_granularity_minutes?: number;
	}>();

	if (body.time_granularity_minutes !== undefined && (body.time_granularity_minutes < 5 || body.time_granularity_minutes > 60)) {
		return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'time_granularity_minutes must be between 5 and 60' } }, 400);
	}

	if (body.display_name !== undefined && body.display_name.length > 50) {
		return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'display_name must be 50 characters or less' } }, 400);
	}

	const updates: Record<string, unknown> = {};
	if (body.discord_username !== undefined) updates.discord_username = body.discord_username;
	if (body.display_name !== undefined) updates.display_name = body.display_name;
	if (body.sync_name_from_discord !== undefined) updates.sync_name_from_discord = body.sync_name_from_discord ? 1 : 0;
	if (body.timezone !== undefined) updates.timezone = body.timezone;
	if (body.time_granularity_minutes !== undefined) updates.time_granularity_minutes = body.time_granularity_minutes;

	const updated = await updateUser(c.env.DB, user.id, updates);
	return c.json({ ok: true, data: updated });
});

export default users;
