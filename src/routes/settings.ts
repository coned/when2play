import { Hono } from 'hono';
import type { Bindings } from '../env';
import { requireAuth } from '../middleware/auth';
import { requireBotAuth } from '../middleware/bot-auth';
import { getAllSettings, getSetting, updateSettings } from '../db/queries/settings';
import type { UserRow } from '../db/queries/users';

type SettingsEnv = {
	Bindings: Bindings;
	Variables: {
		user: UserRow;
		sessionId: string;
		isAdmin: boolean;
	};
};

const settings = new Hono<SettingsEnv>();

// Bot-authenticated endpoints for channel configuration
settings.get('/bot', requireBotAuth, async (c) => {
	const data = await getAllSettings(c.env.DB);
	return c.json({ ok: true, data });
});

settings.patch('/bot', requireBotAuth, async (c) => {
	const body = await c.req.json<Record<string, unknown>>();
	const data = await updateSettings(c.env.DB, body);
	return c.json({ ok: true, data });
});

// User-authenticated endpoints
settings.use('/*', requireAuth);

// GET /api/settings
settings.get('/', async (c) => {
	const data = await getAllSettings(c.env.DB);
	return c.json({ ok: true, data });
});

// PATCH /api/settings -- admin only (Discord-gated via /when2play-admin bot command)
settings.patch('/', async (c) => {
	if (!c.get('isAdmin')) {
		return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Only the admin can update settings' } }, 403);
	}

	const body = await c.req.json<Record<string, unknown>>();
	const data = await updateSettings(c.env.DB, body);
	return c.json({ ok: true, data });
});

export default settings;
