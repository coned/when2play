import { Hono } from 'hono';
import type { Bindings } from '../env';
import { requireAuth } from '../middleware/auth';
import { createGatherPing, getLastGatherPing, getPendingGatherPings, markGatherDelivered } from '../db/queries/gather';
import { getSetting } from '../db/queries/settings';
import type { UserRow } from '../db/queries/users';

type GatherEnv = {
	Bindings: Bindings;
	Variables: {
		user: UserRow;
		sessionId: string;
	};
};

const gather = new Hono<GatherEnv>();

// POST /api/gather — ring the bell (requires auth, rate-limited)
gather.post('/', requireAuth, async (c) => {
	const user = c.get('user');

	// Check cooldown
	const cooldownMinutes = ((await getSetting(c.env.DB, 'gather_cooldown_minutes')) as number) ?? 30;
	const lastPing = await getLastGatherPing(c.env.DB, user.id);

	if (lastPing) {
		const cooldownMs = cooldownMinutes * 60 * 1000;
		const elapsed = Date.now() - new Date(lastPing.created_at).getTime();
		if (elapsed < cooldownMs) {
			const remainingSeconds = Math.ceil((cooldownMs - elapsed) / 1000);
			return c.json(
				{ ok: false, error: { code: 'RATE_LIMITED', message: `Cooldown active. Try again in ${remainingSeconds}s` } },
				429,
			);
		}
	}

	const body = await c.req.json<{ message?: string }>().catch(() => ({}));
	const ping = await createGatherPing(c.env.DB, user.id, body.message);
	return c.json({ ok: true, data: { ...ping, delivered: Boolean(ping.delivered) } }, 201);
});

// GET /api/gather/pending — bot polls for undelivered pings
gather.get('/pending', async (c) => {
	const pings = await getPendingGatherPings(c.env.DB);
	const data = pings.map((p) => ({ ...p, delivered: Boolean(p.delivered) }));
	return c.json({ ok: true, data });
});

// PATCH /api/gather/:id/delivered — bot marks ping as delivered
gather.patch('/:id/delivered', async (c) => {
	const id = c.req.param('id');
	await markGatherDelivered(c.env.DB, id);
	return c.json({ ok: true, data: null });
});

export default gather;
