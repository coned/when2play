import { Hono, type Context } from 'hono';
import { z } from 'zod';
import type { Bindings } from '../env';
import { requireAuth } from '../middleware/auth';
import { requireBotAuth } from '../middleware/bot-auth';
import {
	createGame, getGames, getGameById, updateGame, archiveGame, restoreGame, getGameBySteamAppId,
	deleteGamePermanently, touchGameActivity, autoArchiveStaleGames,
	createGameShare, getPendingGameShares, markGameShareDelivered, formatPendingGameShare,
} from '../db/queries/games';
import { setReaction, removeReaction, getReactionCountsForGames, getUserReactions, getReactionUsersForGames } from '../db/queries/game-reactions';
import { logActivity, getActivity } from '../db/queries/game-activity';
import type { UserRow } from '../db/queries/users';
import { refreshStaleImages } from '../lib/image-refresh';
import { getSetting } from '../db/queries/settings';
import { checkShareCooldown, rateLimited } from '../db/queries/rate-limit';
import { getBotStatus } from '../lib/bot-status';
import { isDelivered } from '../lib/pending';
import { firstIssueMessage } from '../lib/schemas';

type GamesEnv = {
	Bindings: Bindings;
	Variables: {
		user: UserRow;
		sessionId: string;
	};
};

const games = new Hono<GamesEnv>();

const BODY_NOT_OBJECT = 'Request body must be a JSON object';

const gameNameSchema = z
	.string({ required_error: 'name is required', invalid_type_error: 'name must be a string' })
	.trim()
	.min(1, 'name must be 1 to 100 characters')
	.max(100, 'name must be 1 to 100 characters');

// steam_app_id is interpolated into a Steam CDN URL, so only digits are accepted
const steamAppIdSchema = z
	.string({ invalid_type_error: 'steam_app_id must be a string of digits' })
	.regex(/^\d{1,10}$/, 'steam_app_id must be 1 to 10 digits');

const imageUrlSchema = z
	.string({ invalid_type_error: 'image_url must be a string' })
	.max(500, 'image_url must be 500 characters or less')
	.refine(isHttpUrl, 'image_url must be an http or https URL');

const noteSchema = z.string({ invalid_type_error: 'note must be a string' }).max(500, 'note must be 500 characters or less');

const createGameSchema = z.object(
	{
		name: gameNameSchema,
		steam_app_id: steamAppIdSchema.optional(),
		image_url: imageUrlSchema.optional(),
		note: noteSchema.optional(),
	},
	{ invalid_type_error: BODY_NOT_OBJECT, required_error: BODY_NOT_OBJECT },
);

const updateGameSchema = z.object(
	{
		name: gameNameSchema.optional(),
		image_url: imageUrlSchema.optional(),
		note: noteSchema.optional(),
	},
	{ invalid_type_error: BODY_NOT_OBJECT, required_error: BODY_NOT_OBJECT },
);

/** Archive reasons the web app sends; the auto-archive job sets its own reason directly in the database. */
export const ARCHIVE_REASONS = ['not_interested', 'save_for_later'] as const;

const archiveSchema = z.object(
	{ reason: z.enum(ARCHIVE_REASONS, { errorMap: () => ({ message: `reason must be one of: ${ARCHIVE_REASONS.join(', ')}` }) }).optional() },
	{ invalid_type_error: BODY_NOT_OBJECT },
);

function isHttpUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === 'http:' || url.protocol === 'https:';
	} catch {
		return false;
	}
}

function badRequest(message: string) {
	return { ok: false as const, error: { code: 'BAD_REQUEST', message } };
}

/**
 * Schedule background work via waitUntil. Hono's executionCtx getter throws
 * when there is no ExecutionContext (e.g. app.request() in tests), so the
 * work is skipped there instead of failing the request.
 */
function runInBackground(c: Context<GamesEnv>, task: () => Promise<unknown>): void {
	let ctx: Context<GamesEnv>['executionCtx'];
	try {
		ctx = c.executionCtx;
	} catch {
		return;
	}
	ctx.waitUntil(task());
}

// --- Bot-auth endpoints (registered before the blanket requireAuth) ---

// GET /api/games/share/pending -- bot polls for pending game shares (legacy, see /api/bot/poll)
games.get('/share/pending', requireBotAuth, async (c) => {
	const shares = await getPendingGameShares(c.env.DB);
	const data = shares.map(formatPendingGameShare);
	return c.json({ ok: true, data });
});

// PATCH /api/games/share/:id/delivered -- bot marks game share delivered
games.patch('/share/:id/delivered', requireBotAuth, async (c) => {
	const id = c.req.param('id');
	await markGameShareDelivered(c.env.DB, id);
	return c.json({ ok: true, data: null });
});

// --- User-auth endpoints ---
games.use('/*', requireAuth);

// GET /api/games
games.get('/', async (c) => {
	const user = c.get('user');
	const poolParam = c.req.query('pool') as 'active' | 'archive' | 'all' | undefined;
	// Support legacy include_archived param
	const includeArchived = c.req.query('include_archived') === 'true';
	const pool = poolParam ?? (includeArchived ? 'all' : 'active');

	// Auto-archive stale games on active pool fetch
	if (pool === 'active' || pool === 'all') {
		const autoEnabled = await getSetting(c.env.DB, 'auto_archive_enabled');
		if (autoEnabled !== false) {
			const lifespanRaw = await getSetting(c.env.DB, 'game_pool_lifespan_days');
			const lifespan = typeof lifespanRaw === 'number' ? lifespanRaw : 7;
			if (lifespan > 0) {
				runInBackground(c, () => autoArchiveStaleGames(c.env.DB, lifespan));
			}
		}
	}

	const results = await getGames(c.env.DB, pool);
	const reactionCounts = await getReactionCountsForGames(c.env.DB);
	const userReactions = await getUserReactions(c.env.DB, user.id);
	const reactionUsers = await getReactionUsersForGames(c.env.DB);

	const data = results.map((g) => ({
		...g,
		is_archived: Boolean(g.is_archived),
		like_count: reactionCounts.get(g.id)?.like_count ?? 0,
		dislike_count: reactionCounts.get(g.id)?.dislike_count ?? 0,
		user_reaction: userReactions.get(g.id) ?? null,
		reaction_users: reactionUsers.get(g.id) ?? [],
	}));

	runInBackground(c, () => refreshStaleImages(c.env.DB, results));

	return c.json({ ok: true, data });
});

// GET /api/games/activity
games.get('/activity', async (c) => {
	const limitParam = c.req.query('limit');
	const before = c.req.query('before');
	const limit = limitParam ? Math.min(parseInt(limitParam, 10), 50) : 20;

	const activity = await getActivity(c.env.DB, limit, before);
	return c.json({ ok: true, data: activity });
});

// POST /api/games
games.post('/', async (c) => {
	const user = c.get('user');
	const raw = await c.req.json().catch(() => null);
	const parsed = createGameSchema.safeParse(raw);
	if (!parsed.success) {
		return c.json(badRequest(firstIssueMessage(parsed.error, BODY_NOT_OBJECT)), 400);
	}
	const body = parsed.data;

	// Duplicate detection by steam_app_id
	if (body.steam_app_id) {
		const existing = await getGameBySteamAppId(c.env.DB, body.steam_app_id);
		if (existing) {
			if (existing.is_archived) {
				return c.json({
					ok: false,
					error: { code: 'ARCHIVED_DUPLICATE', message: 'This game is in the archive', existing_game_id: existing.id },
				}, 409);
			}
			return c.json({
				ok: false,
				error: { code: 'DUPLICATE_GAME', message: 'This game is already in the pool', existing_game_id: existing.id },
			}, 409);
		}
	}

	// Image upgrade: use Steam header image if steam_app_id is provided
	let imageUrl = body.image_url;
	if (body.steam_app_id) {
		const headerUrl = `https://cdn.akamai.steamstatic.com/steam/apps/${body.steam_app_id}/header.jpg`;
		if (!imageUrl || imageUrl.includes('/search/') || imageUrl.includes('capsule_sm_120')) {
			imageUrl = headerUrl;
		}
	}

	const game = await createGame(c.env.DB, body.name, user.id, body.steam_app_id, imageUrl, body.note);
	await logActivity(c.env.DB, game.id, user.id, 'propose');

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

	const raw = await c.req.json().catch(() => null);
	const parsed = updateGameSchema.safeParse(raw);
	if (!parsed.success) {
		return c.json(badRequest(firstIssueMessage(parsed.error, BODY_NOT_OBJECT)), 400);
	}
	const updated = await updateGame(c.env.DB, id, parsed.data);
	return c.json({ ok: true, data: { ...updated, is_archived: Boolean(updated!.is_archived) } });
});

// DELETE /api/games/:id (archives, doesn't delete) -- any user can archive
games.delete('/:id', async (c) => {
	const user = c.get('user');
	const id = c.req.param('id');
	const game = await getGameById(c.env.DB, id);

	if (!game) {
		return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Game not found' } }, 404);
	}

	// No body (or an empty one) archives as not_interested
	const text = await c.req.text();
	let raw: unknown = {};
	if (text.trim() !== '') {
		try {
			raw = JSON.parse(text);
		} catch {
			return c.json(badRequest(BODY_NOT_OBJECT), 400);
		}
	}
	const parsed = archiveSchema.safeParse(raw);
	if (!parsed.success) {
		return c.json(badRequest(firstIssueMessage(parsed.error, BODY_NOT_OBJECT)), 400);
	}
	const reason = parsed.data.reason ?? 'not_interested';
	await archiveGame(c.env.DB, id, reason);

	const detail = JSON.stringify({ reason });
	await logActivity(c.env.DB, id, user.id, 'archive', detail);

	return c.json({ ok: true, data: null });
});

// DELETE /api/games/:id/permanent -- permanently remove from archive
games.delete('/:id/permanent', async (c) => {
	const user = c.get('user');
	const id = c.req.param('id');
	const game = await getGameById(c.env.DB, id);

	if (!game) {
		return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Game not found' } }, 404);
	}
	if (!game.is_archived) {
		return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Game must be archived before permanent deletion' } }, 400);
	}
	if (game.proposed_by !== user.id) {
		return c.json({ ok: false, error: { code: 'FORBIDDEN', message: 'Only the proposer can permanently delete this game' } }, 403);
	}

	await deleteGamePermanently(c.env.DB, id);
	return c.json({ ok: true, data: null });
});

// POST /api/games/:id/restore
games.post('/:id/restore', async (c) => {
	const user = c.get('user');
	const id = c.req.param('id');
	const game = await getGameById(c.env.DB, id);

	if (!game) {
		return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Game not found' } }, 404);
	}
	if (!game.is_archived) {
		return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Game is not archived' } }, 400);
	}

	await restoreGame(c.env.DB, id);
	await logActivity(c.env.DB, id, user.id, 'restore');

	return c.json({ ok: true, data: null });
});

// PUT /api/games/:id/react
games.put('/:id/react', async (c) => {
	const user = c.get('user');
	const id = c.req.param('id');
	const game = await getGameById(c.env.DB, id);

	if (!game) {
		return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Game not found' } }, 404);
	}

	const body = (await c.req.json().catch(() => null)) as { type?: unknown } | null;
	if (!body || (body.type !== 'like' && body.type !== 'dislike')) {
		return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'type must be "like" or "dislike"' } }, 400);
	}

	const type = body.type;
	await setReaction(c.env.DB, id, user.id, type);
	await logActivity(c.env.DB, id, user.id, type);
	await touchGameActivity(c.env.DB, id);

	return c.json({ ok: true, data: null });
});

// DELETE /api/games/:id/react
games.delete('/:id/react', async (c) => {
	const user = c.get('user');
	const id = c.req.param('id');
	const game = await getGameById(c.env.DB, id);

	if (!game) {
		return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Game not found' } }, 404);
	}

	await removeReaction(c.env.DB, id, user.id);
	await logActivity(c.env.DB, id, user.id, 'unreact');

	return c.json({ ok: true, data: null });
});

// POST /api/games/:id/share -- broadcast game to Discord
games.post('/:id/share', async (c) => {
	const user = c.get('user');
	const id = c.req.param('id');
	const game = await getGameById(c.env.DB, id);

	if (!game) {
		return c.json({ ok: false, error: { code: 'NOT_FOUND', message: 'Game not found' } }, 404);
	}

	const limited = await checkShareCooldown(c.env.DB, user.id, 'game_share');
	if (limited) return c.json(rateLimited(limited), 429);

	const share = await createGameShare(c.env.DB, id, user.id);
	await logActivity(c.env.DB, id, user.id, 'share');
	await touchGameActivity(c.env.DB, id);
	const bot = await getBotStatus(c.env.DB);
	return c.json({ ok: true, data: { ...share, delivered: isDelivered(share.delivered), bot_online: bot.online } }, 201);
});

export default games;
