import { Hono } from 'hono';
import type { Bindings } from '../env';
import { requireAuth } from '../middleware/auth';
import { requireBotAuth } from '../middleware/bot-auth';
import type { UserRow } from '../db/queries/users';
import {
	getDayKey,
	createOrGetRally,
	getActiveRally,
	createRallyAction,
	getRallyActions,
	getPendingRallyActions,
	markActionDelivered,
	getTreeData,
	computeJudgeTime,
	createTreeShare,
	getPendingTreeShares,
	markTreeShareDelivered,
	formatPendingRallyAction,
	formatPendingTreeShare,
	formatRallyAction,
	toPublicRally,
} from '../db/queries/rally';
import type { ActionType } from '@when2play/shared';
import { getGameRanking } from '../db/queries/votes';
import { getSetting } from '../db/queries/settings';

type RallyEnv = {
	Bindings: Bindings;
	Variables: {
		user: UserRow;
		sessionId: string;
	};
};

const rally = new Hono<RallyEnv>();

const VALID_ACTION_TYPES: ActionType[] = ['in', 'out', 'ping', 'brb', 'where'];

/** Default of the rally_anonymous_enabled setting (seeded in 0000_init.sql). */
const DEFAULT_ANONYMOUS_ENABLED: Record<string, boolean> = { call: true, ping: true };

/**
 * Whether the admin allows anonymous actions of this type. Enforced here so
 * that nobody believes they posted anonymously when the UI was bypassed.
 */
async function isAnonymousAllowed(db: D1Database, actionType: ActionType): Promise<boolean> {
	const raw = await getSetting(db, 'rally_anonymous_enabled');
	const enabled = raw && typeof raw === 'object' && !Array.isArray(raw)
		? (raw as Record<string, unknown>)
		: DEFAULT_ANONYMOUS_ENABLED;
	return enabled[actionType] === true;
}

/** Validate is_anonymous; returns an error message, or null when the request may proceed. */
async function checkAnonymous(db: D1Database, actionType: ActionType, isAnonymous: unknown): Promise<string | null> {
	if (isAnonymous === undefined || isAnonymous === false) return null;
	if (isAnonymous !== true) return 'is_anonymous must be a boolean';
	if (!(await isAnonymousAllowed(db, actionType))) return `Anonymous ${actionType} actions are disabled on this server`;
	return null;
}

function badRequest(message: string) {
	return { ok: false as const, error: { code: 'BAD_REQUEST', message } };
}

// POST /api/rally/call — create or get today's rally + record call action
rally.post('/call', requireAuth, async (c) => {
	const user = c.get('user');
	const body = await c.req.json<{ message?: string; is_anonymous?: boolean }>().catch(() => ({} as { message?: string; is_anonymous?: boolean }));

	const anonError = await checkAnonymous(c.env.DB, 'call', body.is_anonymous);
	if (anonError) return c.json(badRequest(anonError), 400);

	const dayKey = await getDayKey(c.env.DB);
	const rallyRow = await createOrGetRally(c.env.DB, user.id, 'now', dayKey);

	const metadata = body.is_anonymous ? { is_anonymous: true } : undefined;
	const action = await createRallyAction(c.env.DB, user.id, 'call', {
		rallyId: rallyRow.id,
		message: body.message || undefined,
		dayKey,
		metadata,
	});

	return c.json({
		ok: true,
		data: {
			rally: toPublicRally(rallyRow),
			action: formatRallyAction(action),
		},
	}, 201);
});

// POST /api/rally/action — record an action (in/out/ping/brb/where)
rally.post('/action', requireAuth, async (c) => {
	const user = c.get('user');
	const body = await c.req.json<{
		action_type: ActionType;
		rally_id?: string;
		target_user_ids?: string[];
		message?: string;
		is_anonymous?: boolean;
	}>().catch(() => ({ action_type: '' as ActionType, rally_id: undefined as string | undefined, target_user_ids: undefined as string[] | undefined, message: undefined as string | undefined, is_anonymous: undefined as boolean | undefined }));

	if (!VALID_ACTION_TYPES.includes(body.action_type)) {
		return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: `Invalid action_type. Must be one of: ${VALID_ACTION_TYPES.join(', ')}` } }, 400);
	}

	if (['ping', 'where'].includes(body.action_type) && (!body.target_user_ids || body.target_user_ids.length === 0)) {
		return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'target_user_ids required for ping/where actions' } }, 400);
	}

	if (body.message && body.message.length > 500) {
		return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Message must be 500 characters or less' } }, 400);
	}

	const anonError = await checkAnonymous(c.env.DB, body.action_type, body.is_anonymous);
	if (anonError) return c.json(badRequest(anonError), 400);

	const dayKey = await getDayKey(c.env.DB);
	// Auto-attach to active rally if no rally_id specified
	let rallyId = body.rally_id;
	if (!rallyId) {
		const activeRally = await getActiveRally(c.env.DB, dayKey);
		rallyId = activeRally?.id ?? undefined;
	}

	const metadata = body.is_anonymous ? { is_anonymous: true } : undefined;
	const action = await createRallyAction(c.env.DB, user.id, body.action_type, {
		rallyId,
		targetUserIds: body.target_user_ids,
		message: body.message,
		dayKey,
		metadata,
	});

	return c.json({ ok: true, data: formatRallyAction(action) }, 201);
});

// POST /api/rally/judge/time — compute & broadcast optimal time slots
rally.post('/judge/time', requireAuth, async (c) => {
	const user = c.get('user');
	const dayKey = await getDayKey(c.env.DB);
	const result = await computeJudgeTime(c.env.DB, dayKey);

	const activeRally = await getActiveRally(c.env.DB, dayKey);

	const action = await createRallyAction(c.env.DB, user.id, 'judge_time', {
		rallyId: activeRally?.id,
		metadata: result,
		dayKey,
	});

	return c.json({
		ok: true,
		data: {
			...action,
			delivered: Boolean(action.delivered),
			target_user_ids: null,
			metadata: result,
		},
	}, 201);
});

// POST /api/rally/judge/avail — nudge user to set availability
rally.post('/judge/avail', requireAuth, async (c) => {
	const user = c.get('user');
	const body = await c.req.json<{ target_user_ids: string[]; message?: string }>().catch(() => ({ target_user_ids: [] as string[], message: undefined as string | undefined }));

	if (!body.target_user_ids || body.target_user_ids.length === 0) {
		return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'target_user_ids required' } }, 400);
	}

	if (body.message && body.message.length > 500) {
		return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Message must be 500 characters or less' } }, 400);
	}

	const dayKey = await getDayKey(c.env.DB);
	const activeRally = await getActiveRally(c.env.DB, dayKey);

	const action = await createRallyAction(c.env.DB, user.id, 'judge_avail', {
		rallyId: activeRally?.id,
		targetUserIds: body.target_user_ids,
		message: body.message || undefined,
		dayKey,
	});

	return c.json({
		ok: true,
		data: {
			...action,
			delivered: Boolean(action.delivered),
			target_user_ids: body.target_user_ids,
			metadata: null,
		},
	}, 201);
});

// POST /api/rally/share-ranking — broadcast current game ranking to Discord
rally.post('/share-ranking', requireAuth, async (c) => {
	const user = c.get('user');
	const dayKey = await getDayKey(c.env.DB);
	const ranking = await getGameRanking(c.env.DB);
	const activeRally = await getActiveRally(c.env.DB, dayKey);

	const action = await createRallyAction(c.env.DB, user.id, 'share_ranking', {
		rallyId: activeRally?.id,
		metadata: { ranking: ranking.slice(0, 10).map((r) => ({ name: r.name, total_score: r.total_score, vote_count: r.vote_count, steam_app_id: r.steam_app_id, like_count: r.like_count })) },
		dayKey,
	});

	return c.json({
		ok: true,
		data: {
			...action,
			delivered: Boolean(action.delivered),
			target_user_ids: null,
			metadata: { ranking },
		},
	}, 201);
});

// GET /api/rally/active — get today's active rally + actions
rally.get('/active', requireAuth, async (c) => {
	const dayKey = c.req.query('day_key') ?? (await getDayKey(c.env.DB));
	const activeRally = await getActiveRally(c.env.DB, dayKey);
	const actions = await getRallyActions(c.env.DB, dayKey);

	const formattedActions = actions.map((a) => formatRallyAction(a));

	return c.json({ ok: true, data: { rally: toPublicRally(activeRally), actions: formattedActions } });
});

// GET /api/rally/tree — get tree DAG data for visualization
rally.get('/tree', requireAuth, async (c) => {
	const dayKey = c.req.query('day_key') ?? (await getDayKey(c.env.DB));
	const treeData = await getTreeData(c.env.DB, dayKey);

	const nodes = treeData.nodes.map((n) => formatRallyAction(n));

	return c.json({ ok: true, data: { nodes, edges: treeData.edges, rallies: treeData.rallies, participants: treeData.participants } });
});

// GET /api/rally/pending — bot polls for undelivered actions (legacy, see /api/bot/poll)
rally.get('/pending', requireBotAuth, async (c) => {
	const actions = await getPendingRallyActions(c.env.DB);
	const data = actions.map(formatPendingRallyAction);
	return c.json({ ok: true, data });
});

// PATCH /api/rally/:id/delivered — bot marks action delivered
rally.patch('/:id/delivered', requireBotAuth, async (c) => {
	const id = c.req.param('id');
	await markActionDelivered(c.env.DB, id);
	return c.json({ ok: true, data: null });
});

// POST /api/rally/tree/share — upload PNG for Discord sharing
rally.post('/tree/share', requireAuth, async (c) => {
	const user = c.get('user');
	const body = await c.req.json<{ image_data: string }>().catch(() => ({ image_data: '' as string }));

	if (!body.image_data) {
		return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'image_data required' } }, 400);
	}

	const dayKey = await getDayKey(c.env.DB);
	const share = await createTreeShare(c.env.DB, user.id, dayKey, body.image_data);

	return c.json({
		ok: true,
		data: { ...share, delivered: Boolean(share.delivered) },
	}, 201);
});

// GET /api/rally/tree/share/pending — bot polls for pending tree images (legacy, see /api/bot/poll)
rally.get('/tree/share/pending', requireBotAuth, async (c) => {
	const shares = await getPendingTreeShares(c.env.DB);
	const data = shares.map(formatPendingTreeShare);
	return c.json({ ok: true, data });
});

// PATCH /api/rally/tree/share/:id/delivered — bot marks tree share delivered
rally.patch('/tree/share/:id/delivered', requireBotAuth, async (c) => {
	const id = c.req.param('id');
	await markTreeShareDelivered(c.env.DB, id);
	return c.json({ ok: true, data: null });
});

export default rally;
