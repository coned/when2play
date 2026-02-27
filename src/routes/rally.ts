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
} from '../db/queries/rally';
import type { ActionType } from '@when2play/shared';

type RallyEnv = {
	Bindings: Bindings;
	Variables: {
		user: UserRow;
		sessionId: string;
	};
};

const rally = new Hono<RallyEnv>();

const VALID_ACTION_TYPES: ActionType[] = ['in', 'out', 'ping', 'brb', 'where'];

// POST /api/rally/call — create or get today's rally + record call action
rally.post('/call', requireAuth, async (c) => {
	const user = c.get('user');
	const body = await c.req.json<{ timing?: 'now' | 'later' }>().catch(() => ({} as { timing?: 'now' | 'later' }));
	const timing = body.timing === 'later' ? 'later' : 'now';

	const dayKey = await getDayKey(c.env.DB);
	const rallyRow = await createOrGetRally(c.env.DB, user.id, timing, dayKey);

	const action = await createRallyAction(c.env.DB, user.id, 'call', {
		rallyId: rallyRow.id,
		message: timing,
		dayKey,
	});

	return c.json({
		ok: true,
		data: {
			rally: rallyRow,
			action: {
				...action,
				delivered: Boolean(action.delivered),
				target_user_ids: null,
				metadata: null,
			},
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
	}>().catch(() => ({ action_type: '' as ActionType, rally_id: undefined as string | undefined, target_user_ids: undefined as string[] | undefined, message: undefined as string | undefined }));

	if (!VALID_ACTION_TYPES.includes(body.action_type)) {
		return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: `Invalid action_type. Must be one of: ${VALID_ACTION_TYPES.join(', ')}` } }, 400);
	}

	if (['ping', 'where'].includes(body.action_type) && (!body.target_user_ids || body.target_user_ids.length === 0)) {
		return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'target_user_ids required for ping/where actions' } }, 400);
	}

	if (body.message && body.message.length > 500) {
		return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'Message must be 500 characters or less' } }, 400);
	}

	const dayKey = await getDayKey(c.env.DB);
	// Auto-attach to active rally if no rally_id specified
	let rallyId = body.rally_id;
	if (!rallyId) {
		const activeRally = await getActiveRally(c.env.DB, dayKey);
		rallyId = activeRally?.id ?? undefined;
	}

	const action = await createRallyAction(c.env.DB, user.id, body.action_type, {
		rallyId,
		targetUserIds: body.target_user_ids,
		message: body.message,
		dayKey,
	});

	return c.json({
		ok: true,
		data: {
			...action,
			delivered: Boolean(action.delivered),
			target_user_ids: action.target_user_ids ? JSON.parse(action.target_user_ids) : null,
			metadata: action.metadata ? JSON.parse(action.metadata) : null,
		},
	}, 201);
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
	const body = await c.req.json<{ target_user_ids: string[] }>().catch(() => ({ target_user_ids: [] as string[] }));

	if (!body.target_user_ids || body.target_user_ids.length === 0) {
		return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'target_user_ids required' } }, 400);
	}

	const dayKey = await getDayKey(c.env.DB);
	const activeRally = await getActiveRally(c.env.DB, dayKey);

	const action = await createRallyAction(c.env.DB, user.id, 'judge_avail', {
		rallyId: activeRally?.id,
		targetUserIds: body.target_user_ids,
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

// GET /api/rally/active — get today's active rally + actions
rally.get('/active', requireAuth, async (c) => {
	const dayKey = c.req.query('day_key') ?? (await getDayKey(c.env.DB));
	const activeRally = await getActiveRally(c.env.DB, dayKey);
	const actions = await getRallyActions(c.env.DB, dayKey);

	const formattedActions = actions.map((a) => ({
		...a,
		delivered: Boolean(a.delivered),
		target_user_ids: a.target_user_ids ? JSON.parse(a.target_user_ids) : null,
		metadata: a.metadata ? JSON.parse(a.metadata) : null,
	}));

	return c.json({ ok: true, data: { rally: activeRally, actions: formattedActions } });
});

// GET /api/rally/tree — get tree DAG data for visualization
rally.get('/tree', requireAuth, async (c) => {
	const dayKey = c.req.query('day_key') ?? (await getDayKey(c.env.DB));
	const treeData = await getTreeData(c.env.DB, dayKey);

	const nodes = treeData.nodes.map((n) => ({
		...n,
		delivered: Boolean(n.delivered),
		target_user_ids: n.target_user_ids ? JSON.parse(n.target_user_ids) : null,
		metadata: n.metadata ? JSON.parse(n.metadata) : null,
	}));

	return c.json({ ok: true, data: { nodes, edges: treeData.edges, rallies: treeData.rallies } });
});

// GET /api/rally/pending — bot polls for undelivered actions
rally.get('/pending', requireBotAuth, async (c) => {
	const actions = await getPendingRallyActions(c.env.DB);
	const data = actions.map((a) => ({
		...a,
		delivered: Boolean(a.delivered),
		target_user_ids: a.target_user_ids ? JSON.parse(a.target_user_ids) : null,
		metadata: a.metadata ? JSON.parse(a.metadata) : null,
	}));
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

// GET /api/rally/tree/share/pending — bot polls for pending tree images
rally.get('/tree/share/pending', requireBotAuth, async (c) => {
	const shares = await getPendingTreeShares(c.env.DB);
	const data = shares.map((s) => ({ ...s, delivered: Boolean(s.delivered) }));
	return c.json({ ok: true, data });
});

// PATCH /api/rally/tree/share/:id/delivered — bot marks tree share delivered
rally.patch('/tree/share/:id/delivered', requireBotAuth, async (c) => {
	const id = c.req.param('id');
	await markTreeShareDelivered(c.env.DB, id);
	return c.json({ ok: true, data: null });
});

export default rally;
