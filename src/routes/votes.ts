import { Hono } from 'hono';
import type { Bindings } from '../env';
import { requireAuth } from '../middleware/auth';
import { setVote, deleteVote, getVotesForGame, getGameRanking } from '../db/queries/votes';
import { getGameById } from '../db/queries/games';
import type { UserRow } from '../db/queries/users';

type VotesEnv = {
	Bindings: Bindings;
	Variables: {
		user: UserRow;
		sessionId: string;
	};
};

const votes = new Hono<VotesEnv>();

votes.use('/*', requireAuth);

// GET /api/games/ranking — aggregated Borda count
votes.get('/ranking', async (c) => {
	const ranking = await getGameRanking(c.env.DB);
	return c.json({ ok: true, data: ranking });
});

// PUT /api/games/:id/vote
votes.put('/:id/vote', async (c) => {
	const user = c.get('user');
	const gameId = c.req.param('id');
	const body = await c.req.json<{ rank: number; is_approved?: boolean }>();

	if (!body.rank || body.rank < 1) {
		return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'rank must be a positive integer' } }, 400);
	}

	const game = await getGameById(c.env.DB, gameId);
	if (!game) {
		return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Game not found' } }, 404);
	}

	const vote = await setVote(c.env.DB, gameId, user.id, body.rank, body.is_approved ?? true);
	return c.json({ ok: true, data: { ...vote, is_approved: Boolean(vote.is_approved) } });
});

// DELETE /api/games/:id/vote
votes.delete('/:id/vote', async (c) => {
	const user = c.get('user');
	const gameId = c.req.param('id');

	await deleteVote(c.env.DB, gameId, user.id);
	return c.json({ ok: true, data: null });
});

// GET /api/games/:id/votes
votes.get('/:id/votes', async (c) => {
	const gameId = c.req.param('id');
	const gameVotes = await getVotesForGame(c.env.DB, gameId);
	const data = gameVotes.map((v) => ({ ...v, is_approved: Boolean(v.is_approved) }));
	return c.json({ ok: true, data });
});

export default votes;
