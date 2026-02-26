import { Hono } from 'hono';
import type { Bindings } from '../env';
import { lookupSteamApp } from '../lib/steam';

const steam = new Hono<{ Bindings: Bindings }>();

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
