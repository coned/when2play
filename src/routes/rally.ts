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
	type RallyActionWithUser,
} from '../db/queries/rally';
import type { ActionType } from '@when2play/shared';
import { getGameRanking } from '../db/queries/votes';
import { getSetting } from '../db/queries/settings';
import { checkRallyRateLimit, checkShareCooldown, rateLimited } from '../db/queries/rate-limit';
import { getBotStatus } from '../lib/bot-status';
import { isDelivered, deliveryStatus } from '../lib/pending';

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

const MAX_MESSAGE_LENGTH = 500;
const MAX_TARGET_USERS = 20;

type JsonObject = Record<string, unknown>;

/**
 * Read the request body as a JSON object. An empty body counts as {}; invalid
 * JSON or any other JSON value (array, string, null ...) returns null so the
 * route can answer 400 instead of failing on a property access.
 */
async function readJsonObject(c: { req: { text(): Promise<string> } }): Promise<JsonObject | null> {
	const text = await c.req.text().catch(() => '');
	if (text.trim() === '') return {};
	try {
		const parsed: unknown = JSON.parse(text);
		return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as JsonObject) : null;
	} catch {
		return null;
	}
}

/** Optional message: absent/null/'' means none, otherwise a string of at most 500 characters. */
function parseMessage(raw: unknown): { message?: string; error?: string } {
	if (raw === undefined || raw === null || raw === '') return {};
	if (typeof raw !== 'string') return { error: 'message must be a string' };
	if (raw.length > MAX_MESSAGE_LENGTH) return { error: 'Message must be 500 characters or less' };
	return { message: raw };
}

/** target_user_ids: an array of 1 to 20 ids of existing users. Returns the ids or an error message. */
async function parseTargetUserIds(db: D1Database, raw: unknown): Promise<{ ids?: string[]; error?: string }> {
	if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_TARGET_USERS) {
		return { error: `target_user_ids must be an array of 1 to ${MAX_TARGET_USERS} user ids` };
	}
	if (!raw.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 100)) {
		return { error: 'target_user_ids must contain user id strings' };
	}
	const ids = raw as string[];
	const unique = Array.from(new Set(ids));
	const ph = unique.map(() => '?').join(',');
	const row = await db
		.prepare(`SELECT COUNT(*) AS n FROM users WHERE id IN (${ph})`)
		.bind(...unique)
		.first<{ n: number }>();
	if (Number(row?.n ?? 0) !== unique.length) return { error: 'target_user_ids contains an unknown user' };
	return { ids };
}

// POST /api/rally/call — create or get today's rally + record call action
rally.post('/call', requireAuth, async (c) => {
	const user = c.get('user');
	const body = await readJsonObject(c);
	if (!body) return c.json(badRequest('Body must be a JSON object'), 400);

	const { message, error: messageError } = parseMessage(body.message);
	if (messageError) return c.json(badRequest(messageError), 400);

	const anonError = await checkAnonymous(c.env.DB, 'call', body.is_anonymous);
	if (anonError) return c.json(badRequest(anonError), 400);

	const limited = await checkRallyRateLimit(c.env.DB, user.id, 'call');
	if (limited) return c.json(rateLimited(limited), 429);

	const dayKey = await getDayKey(c.env.DB);
	const rallyRow = await createOrGetRally(c.env.DB, user.id, 'now', dayKey);

	const metadata = body.is_anonymous === true ? { is_anonymous: true } : undefined;
	const action = await createRallyAction(c.env.DB, user.id, 'call', {
		rallyId: rallyRow.id,
		message,
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
	const body = await readJsonObject(c);
	if (!body) return c.json(badRequest('Body must be a JSON object'), 400);

	const actionType = body.action_type as ActionType;
	if (!VALID_ACTION_TYPES.includes(actionType)) {
		return c.json(badRequest(`Invalid action_type. Must be one of: ${VALID_ACTION_TYPES.join(', ')}`), 400);
	}

	if (['ping', 'where'].includes(actionType) && (!Array.isArray(body.target_user_ids) || body.target_user_ids.length === 0)) {
		return c.json(badRequest('target_user_ids required for ping/where actions'), 400);
	}

	const { message, error: messageError } = parseMessage(body.message);
	if (messageError) return c.json(badRequest(messageError), 400);

	let targetUserIds: string[] | undefined;
	if (body.target_user_ids !== undefined && body.target_user_ids !== null) {
		const targets = await parseTargetUserIds(c.env.DB, body.target_user_ids);
		if (targets.error) return c.json(badRequest(targets.error), 400);
		targetUserIds = targets.ids;
	}

	if (body.rally_id !== undefined && body.rally_id !== null) {
		if (typeof body.rally_id !== 'string') return c.json(badRequest('rally_id must be a string'), 400);
		const exists = await c.env.DB.prepare('SELECT id FROM rallies WHERE id = ?').bind(body.rally_id).first();
		if (!exists) return c.json(badRequest('rally_id does not exist'), 400);
	}

	const anonError = await checkAnonymous(c.env.DB, actionType, body.is_anonymous);
	if (anonError) return c.json(badRequest(anonError), 400);

	const limited = await checkRallyRateLimit(c.env.DB, user.id, actionType);
	if (limited) return c.json(rateLimited(limited), 429);

	const dayKey = await getDayKey(c.env.DB);
	// Auto-attach to active rally if no rally_id specified
	let rallyId = (body.rally_id as string | null | undefined) ?? undefined;
	if (!rallyId) {
		const activeRally = await getActiveRally(c.env.DB, dayKey);
		rallyId = activeRally?.id ?? undefined;
	}

	const metadata = body.is_anonymous === true ? { is_anonymous: true } : undefined;
	const action = await createRallyAction(c.env.DB, user.id, actionType, {
		rallyId,
		targetUserIds,
		message,
		dayKey,
		metadata,
	});

	return c.json({ ok: true, data: formatRallyAction(action) }, 201);
});

// POST /api/rally/judge/time — compute & broadcast optimal time slots
rally.post('/judge/time', requireAuth, async (c) => {
	const user = c.get('user');
	const limited = await checkRallyRateLimit(c.env.DB, user.id, 'judge_time');
	if (limited) return c.json(rateLimited(limited), 429);

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
			delivered: isDelivered(action.delivered),
			target_user_ids: null,
			metadata: result,
		},
	}, 201);
});

// POST /api/rally/judge/avail — nudge user to set availability
rally.post('/judge/avail', requireAuth, async (c) => {
	const user = c.get('user');
	const body = await readJsonObject(c);
	if (!body) return c.json(badRequest('Body must be a JSON object'), 400);

	if (!Array.isArray(body.target_user_ids) || body.target_user_ids.length === 0) {
		return c.json(badRequest('target_user_ids required'), 400);
	}

	const { message, error: messageError } = parseMessage(body.message);
	if (messageError) return c.json(badRequest(messageError), 400);

	const targets = await parseTargetUserIds(c.env.DB, body.target_user_ids);
	if (targets.error) return c.json(badRequest(targets.error), 400);

	const limited = await checkRallyRateLimit(c.env.DB, user.id, 'judge_avail');
	if (limited) return c.json(rateLimited(limited), 429);

	const dayKey = await getDayKey(c.env.DB);
	const activeRally = await getActiveRally(c.env.DB, dayKey);

	const action = await createRallyAction(c.env.DB, user.id, 'judge_avail', {
		rallyId: activeRally?.id,
		targetUserIds: targets.ids,
		message,
		dayKey,
	});

	return c.json({
		ok: true,
		data: {
			...action,
			delivered: isDelivered(action.delivered),
			target_user_ids: targets.ids,
			metadata: null,
		},
	}, 201);
});

// POST /api/rally/share-ranking — broadcast current game ranking to Discord
rally.post('/share-ranking', requireAuth, async (c) => {
	const user = c.get('user');
	const limited = await checkRallyRateLimit(c.env.DB, user.id, 'share_ranking');
	if (limited) return c.json(rateLimited(limited), 429);

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
			delivered: isDelivered(action.delivered),
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

	const bot = await getBotStatus(c.env.DB);
	const nowMs = Date.now();
	const formattedActions = actions.map((a: RallyActionWithUser) => ({
		...formatRallyAction(a),
		delivery_status: deliveryStatus(a.delivered, a.created_at, nowMs),
	}));

	return c.json({ ok: true, data: { rally: toPublicRally(activeRally), actions: formattedActions, bot } });
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
	const body = await readJsonObject(c);
	if (!body) return c.json(badRequest('Body must be a JSON object'), 400);

	if (typeof body.image_data !== 'string' || !body.image_data) {
		return c.json(badRequest('image_data required'), 400);
	}

	const limited = await checkShareCooldown(c.env.DB, user.id, 'tree_share');
	if (limited) return c.json(rateLimited(limited), 429);

	const dayKey = await getDayKey(c.env.DB);
	const share = await createTreeShare(c.env.DB, user.id, dayKey, body.image_data as string);
	const bot = await getBotStatus(c.env.DB);

	return c.json({
		ok: true,
		data: { ...share, delivered: isDelivered(share.delivered), bot_online: bot.online },
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
