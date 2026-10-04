import { Hono } from 'hono';
import { z } from 'zod';
import type { Bindings } from '../env';
import { requireAuth } from '../middleware/auth';
import { setVote, deleteVote, getVotesForGame, getGameRanking, getUserVotesWithGames, bulkUpdateVoteRanks, deleteAllUserVotes } from '../db/queries/votes';
import { getGameById } from '../db/queries/games';
import type { UserRow } from '../db/queries/users';
import { firstIssueMessage } from '../lib/schemas';

type VotesEnv = {
	Bindings: Bindings;
	Variables: {
		user: UserRow;
		sessionId: string;
	};
};

const votes = new Hono<VotesEnv>();

const BODY_NOT_OBJECT = 'Request body must be a JSON object';
export const MAX_RANK = 1000;
export const MAX_RANKINGS = 200;

const rankSchema = z
	.number({ required_error: 'rank is required', invalid_type_error: 'rank must be a positive integer' })
	.int('rank must be a positive integer')
	.min(1, 'rank must be a positive integer')
	.max(MAX_RANK, `rank must be ${MAX_RANK} or less`);

const reorderSchema = z.object(
	{
		rankings: z
			.array(
				z.object(
					{
						game_id: z.string({ required_error: 'game_id is required', invalid_type_error: 'game_id must be a string' }).min(1, 'game_id is required').max(64, 'game_id is too long'),
						rank: rankSchema,
					},
					{ invalid_type_error: 'each ranking must be { game_id, rank }' },
				),
				{ required_error: 'rankings array required', invalid_type_error: 'rankings array required' },
			)
			.min(1, 'rankings array required')
			.max(MAX_RANKINGS, `rankings must have at most ${MAX_RANKINGS} entries`),
	},
	{ invalid_type_error: BODY_NOT_OBJECT, required_error: BODY_NOT_OBJECT },
);

const voteSchema = z.object(
	{
		rank: rankSchema,
		is_approved: z.boolean({ invalid_type_error: 'is_approved must be a boolean' }).optional(),
	},
	{ invalid_type_error: BODY_NOT_OBJECT, required_error: BODY_NOT_OBJECT },
);

votes.use('/*', requireAuth);

// GET /api/games/ranking -- aggregated Borda count
votes.get('/ranking', async (c) => {
	const ranking = await getGameRanking(c.env.DB);
	return c.json({ ok: true, data: ranking });
});

// GET /api/games/my-votes -- user's votes with game data
votes.get('/my-votes', async (c) => {
	const user = c.get('user');
	const myVotes = await getUserVotesWithGames(c.env.DB, user.id);
	const data = myVotes.map((v) => ({ ...v, is_approved: Boolean(v.is_approved) }));
	return c.json({ ok: true, data });
});

// DELETE /api/games/my-votes -- remove all votes for current user
votes.delete('/my-votes', async (c) => {
	const user = c.get('user');
	await deleteAllUserVotes(c.env.DB, user.id);
	return c.json({ ok: true, data: null });
});

// PUT /api/games/reorder-votes -- bulk rank update
votes.put('/reorder-votes', async (c) => {
	const user = c.get('user');
	const parsed = reorderSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) {
		return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: firstIssueMessage(parsed.error, BODY_NOT_OBJECT) } }, 400);
	}

	await bulkUpdateVoteRanks(c.env.DB, user.id, parsed.data.rankings);
	return c.json({ ok: true, data: null });
});

// PUT /api/games/:id/vote
votes.put('/:id/vote', async (c) => {
	const user = c.get('user');
	const gameId = c.req.param('id');
	const parsed = voteSchema.safeParse(await c.req.json().catch(() => null));
	if (!parsed.success) {
		return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: firstIssueMessage(parsed.error, BODY_NOT_OBJECT) } }, 400);
	}
	const body = parsed.data;

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
	const data = gameVotes.map(({ user_id, ...v }) => ({ ...v, is_approved: Boolean(v.is_approved) }));
	return c.json({ ok: true, data });
});

export default votes;
