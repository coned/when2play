import { Hono } from 'hono';
import type { Bindings } from '../env';
import { requireAuth } from '../middleware/auth';
import { createShameVote, deleteShameVote, getShameLeaderboard, getMyShameVotesToday } from '../db/queries/shame';
import { getUserById, type UserRow } from '../db/queries/users';

type ShameEnv = {
	Bindings: Bindings;
	Variables: {
		user: UserRow;
		sessionId: string;
	};
};

const shame = new Hono<ShameEnv>();

shame.use('/*', requireAuth);

// GET /api/shame/my-votes — returns target_ids the current user shamed today
shame.get('/my-votes', async (c) => {
	const user = c.get('user');
	const targetIds = await getMyShameVotesToday(c.env.DB, user.id);
	return c.json({ ok: true, data: targetIds });
});

// GET /api/shame/leaderboard
shame.get('/leaderboard', async (c) => {
	const leaderboard = await getShameLeaderboard(c.env.DB);
	return c.json({ ok: true, data: leaderboard });
});

// POST /api/shame/:targetId
shame.post('/:targetId', async (c) => {
	const user = c.get('user');
	const targetId = c.req.param('targetId');

	const target = await getUserById(c.env.DB, targetId);
	if (!target) {
		return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'User not found' } }, 404);
	}

	const body = await c.req.json<{ reason?: string }>().catch(() => ({}));

	if (body.reason && body.reason.length > 200) {
		return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Reason must be 200 characters or less' } }, 400);
	}

	try {
		const vote = await createShameVote(c.env.DB, user.id, targetId, body.reason);
		return c.json({ ok: true, data: vote }, 201);
	} catch (err: any) {
		if (err.message === 'Already shamed this user today') {
			return c.json({ ok: false, error: { code: 'RATE_LIMITED', message: err.message } }, 429);
		}
		throw err;
	}
});

// DELETE /api/shame/:targetId — withdraw today's shame vote
shame.delete('/:targetId', async (c) => {
	const user = c.get('user');
	const targetId = c.req.param('targetId');
	await deleteShameVote(c.env.DB, user.id, targetId);
	return c.json({ ok: true, data: null });
});

export default shame;
