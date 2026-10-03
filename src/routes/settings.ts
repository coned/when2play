import { Hono } from 'hono';
import type { Bindings } from '../env';
import { requireAuth } from '../middleware/auth';
import { requireBotAuth } from '../middleware/bot-auth';
import { getAllSettings, getSetting, updateSettings } from '../db/queries/settings';
import type { UserRow } from '../db/queries/users';
import { INTERNAL_SETTING_KEYS } from '../lib/bot-status';

/** Drop server-written keys (bot heartbeat) from what users see or may write. */
function withoutInternal(data: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(data)) {
		if (!INTERNAL_SETTING_KEYS.has(key)) out[key] = value;
	}
	return out;
}

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
	return c.json({ ok: true, data: withoutInternal(data) });
});

// PATCH /api/settings -- admin only (Discord-gated via /when2play-admin bot command)
settings.patch('/', async (c) => {
	if (!c.get('isAdmin')) {
		return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Only the admin can update settings' } }, 403);
	}

	const body = await c.req.json<Record<string, unknown>>();
	const data = await updateSettings(c.env.DB, withoutInternal(body));
	return c.json({ ok: true, data: withoutInternal(data) });
});

export default settings;
