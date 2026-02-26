import { Hono } from 'hono';
import type { Bindings } from '../env';
import { requireAuth } from '../middleware/auth';
import { createGame, getGames, getGameById, updateGame, archiveGame } from '../db/queries/games';
import type { UserRow } from '../db/queries/users';

type GamesEnv = {
	Bindings: Bindings;
	Variables: {
		user: UserRow;
		sessionId: string;
	};
};

const games = new Hono<GamesEnv>();

games.use('/*', requireAuth);

// GET /api/games
games.get('/', async (c) => {
	const includeArchived = c.req.query('include_archived') === 'true';
	const results = await getGames(c.env.DB, includeArchived);

	const data = results.map((g) => ({ ...g, is_archived: Boolean(g.is_archived) }));
	return c.json({ ok: true, data });
});

// POST /api/games
games.post('/', async (c) => {
	const user = c.get('user');
	const body = await c.req.json<{ name: string; steam_app_id?: string; image_url?: string }>();

	if (!body.name || body.name.length > 100) {
		return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'name is required and must be 100 characters or less' } }, 400);
	}
	if (body.image_url && body.image_url.length > 500) {
		return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'image_url must be 500 characters or less' } }, 400);
	}

	const game = await createGame(c.env.DB, body.name, user.id, body.steam_app_id, body.image_url);
	return c.json({ ok: true, data: { ...game, is_archived: Boolean(game.is_archived) } }, 201);
});

// PATCH /api/games/:id
games.patch('/:id', async (c) => {
	const user = c.get('user');
	const id = c.req.param('id');
	const game = await getGameById(c.env.DB, id);

	if (!game) {
		return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Game not found' } }, 404);
	}
	if (game.proposed_by !== user.id) {
		return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Only the proposer can update this game' } }, 403);
	}

	const body = await c.req.json<{ name?: string; image_url?: string }>();
	const updated = await updateGame(c.env.DB, id, body);
	return c.json({ ok: true, data: { ...updated, is_archived: Boolean(updated!.is_archived) } });
});

// DELETE /api/games/:id (archives, doesn't delete)
games.delete('/:id', async (c) => {
	const user = c.get('user');
	const id = c.req.param('id');
	const game = await getGameById(c.env.DB, id);

	if (!game) {
		return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Game not found' } }, 404);
	}
	if (game.proposed_by !== user.id) {
		return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Only the proposer can archive this game' } }, 403);
	}

	await archiveGame(c.env.DB, id);
	return c.json({ ok: true, data: null });
});

export default games;
