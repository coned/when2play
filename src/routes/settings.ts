import { Hono } from 'hono';
import type { Bindings } from '../env';
import { requireAuth } from '../middleware/auth';
import { getAllSettings, updateSettings } from '../db/queries/settings';
import type { UserRow } from '../db/queries/users';

type SettingsEnv = {
	Bindings: Bindings;
	Variables: {
		user: UserRow;
		sessionId: string;
	};
};

const settings = new Hono<SettingsEnv>();

settings.use('/*', requireAuth);

// GET /api/settings
settings.get('/', async (c) => {
	const data = await getAllSettings(c.env.DB);
	return c.json({ ok: true, data });
});

// PATCH /api/settings — admin only (first registered user)
settings.patch('/', async (c) => {
	const user = c.get('user');

	const firstUser = await c.env.DB
		.prepare('SELECT id FROM users ORDER BY created_at ASC LIMIT 1')
		.first<{ id: string }>();

	if (!firstUser || firstUser.id !== user.id) {
		return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Only the admin can update settings' } }, 403);
	}

	const body = await c.req.json<Record<string, unknown>>();
	const data = await updateSettings(c.env.DB, body);
	return c.json({ ok: true, data });
});

export default settings;
