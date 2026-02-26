import { Hono } from 'hono';
import type { Bindings } from '../env';
import { requireAuth } from '../middleware/auth';
import { lookupSteamApp, searchSteamApps } from '../lib/steam';
import type { UserRow } from '../db/queries/users';

type SteamEnv = {
	Bindings: Bindings;
	Variables: {
		user: UserRow;
		sessionId: string;
	};
};

const steam = new Hono<SteamEnv>();

// GET /api/steam/search?q=QUERY — search by partial name (auth required)
steam.get('/search', requireAuth, async (c) => {
	const query = c.req.query('q')?.trim();
	if (!query || query.length < 2 || query.length > 100) {
		return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Query must be 2-100 characters' } }, 400);
	}

	const results = await searchSteamApps(query);
	return c.json({ ok: true, data: results });
});

// GET /api/steam/lookup/:appId
steam.get('/lookup/:appId', async (c) => {
	const appId = c.req.param('appId');

	if (!/^\d+$/.test(appId)) {
		return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'appId must be a number' } }, 400);
	}

	const details = await lookupSteamApp(appId);

	if (!details) {
		return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Steam app not found' } }, 404);
	}

	return c.json({ ok: true, data: details });
});

export default steam;
