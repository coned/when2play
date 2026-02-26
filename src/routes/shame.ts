import { Hono } from 'hono';
import type { Bindings } from '../env';
import { requireAuth } from '../middleware/auth';
import { createShameVote, getShameLeaderboard } from '../db/queries/shame';
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

// POST /api/shame/:targetId
shame.post('/:targetId', async (c) => {
	const user = c.get('user');
	const targetId = c.req.param('targetId');

	if (targetId === user.id) {
		return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Cannot shame yourself' } }, 400);
	}

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

// GET /api/shame/leaderboard
shame.get('/leaderboard', async (c) => {
	const leaderboard = await getShameLeaderboard(c.env.DB);
	return c.json({ ok: true, data: leaderboard });
});

export default shame;
