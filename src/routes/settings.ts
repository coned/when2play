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

// PATCH /api/settings
settings.patch('/', async (c) => {
	const body = await c.req.json<Record<string, unknown>>();
	const data = await updateSettings(c.env.DB, body);
	return c.json({ ok: true, data });
});

export default settings;
