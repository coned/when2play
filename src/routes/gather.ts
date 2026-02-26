import { Hono } from 'hono';
import type { Bindings } from '../env';
import { requireAuth } from '../middleware/auth';
import { requireBotAuth } from '../middleware/bot-auth';
import { createGatherPing, getLastGatherPing, getPendingGatherPings, markGatherDelivered, getRecentGatherPingCount, getOldestRecentGatherPing } from '../db/queries/gather';
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

	// Check A — hourly limit
	const hourlyLimit = ((await getSetting(c.env.DB, 'gather_hourly_limit')) as number) ?? 30;
	if (hourlyLimit > 0) {
		const sinceIso = new Date(Date.now() - 3600000).toISOString();
		const count = await getRecentGatherPingCount(c.env.DB, user.id, sinceIso);
		if (count >= hourlyLimit) {
			const oldest = await getOldestRecentGatherPing(c.env.DB, user.id, sinceIso);
			const lockoutExpires = new Date(new Date(oldest!.created_at).getTime() + 3600000);
			const remainingSeconds = Math.ceil((lockoutExpires.getTime() - Date.now()) / 1000);
			return c.json(
				{ ok: false, error: { code: 'RATE_LIMITED', message: `Hourly limit reached. Try again in ${remainingSeconds}s` } },
				429,
			);
		}
	}

	// Check B — per-ping cooldown
	const cooldownSeconds = ((await getSetting(c.env.DB, 'gather_cooldown_seconds')) as number) ?? 10;
	if (cooldownSeconds > 0) {
		const lastPing = await getLastGatherPing(c.env.DB, user.id);
		if (lastPing) {
			const cooldownMs = cooldownSeconds * 1000;
			const elapsed = Date.now() - new Date(lastPing.created_at).getTime();
			if (elapsed < cooldownMs) {
				const remainingSeconds = Math.ceil((cooldownMs - elapsed) / 1000);
				return c.json(
					{ ok: false, error: { code: 'RATE_LIMITED', message: `Cooldown active. Try again in ${remainingSeconds}s` } },
					429,
				);
			}
		}
	}

	const body = await c.req.json<{
		message?: string;
		is_anonymous?: boolean;
		target_user_ids?: string[];
	}>().catch(() => ({}));

	if (body.message && body.message.length > 500) {
		return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Message must be 500 characters or less' } }, 400);
	}

	if (body.target_user_ids && (!Array.isArray(body.target_user_ids) || body.target_user_ids.length > 20)) {
		return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'target_user_ids must be an array of max 20 users' } }, 400);
	}

	const ping = await createGatherPing(c.env.DB, user.id, body.message, {
		is_anonymous: body.is_anonymous,
		target_user_ids: body.target_user_ids,
	});

	return c.json({
		ok: true,
		data: {
			...ping,
			delivered: Boolean(ping.delivered),
			is_anonymous: Boolean(ping.is_anonymous),
			target_user_ids: ping.target_user_ids ? JSON.parse(ping.target_user_ids) : null,
		},
	}, 201);
});

// GET /api/gather/pending — bot polls for undelivered pings
gather.get('/pending', requireBotAuth, async (c) => {
	const pings = await getPendingGatherPings(c.env.DB);
	const data = pings.map((p) => ({
		...p,
		delivered: Boolean(p.delivered),
		is_anonymous: Boolean(p.is_anonymous),
		target_user_ids: p.target_user_ids ? JSON.parse(p.target_user_ids) : null,
		// target_discord_ids is already resolved in the query
	}));
	return c.json({ ok: true, data });
});

// PATCH /api/gather/:id/delivered — bot marks ping as delivered
gather.patch('/:id/delivered', requireBotAuth, async (c) => {
	const id = c.req.param('id');
	await markGatherDelivered(c.env.DB, id);
	return c.json({ ok: true, data: null });
});

export default gather;
