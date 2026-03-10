import type { D1Database } from '@cloudflare/workers-types';
import { uuid, now } from '../helpers';
import { getSetting } from './settings';
import type { ActionType } from '@when2play/shared';

// ---------- Row types ----------

export interface RallyRow {
	id: string;
	creator_id: string;
	timing: string;
	day_key: string;
	status: string;
	created_at: string;
}

export interface RallyActionRow {
	id: string;
	rally_id: string | null;
	actor_id: string;
	action_type: string;
	target_user_ids: string | null;
	message: string | null;
	metadata: string | null;
	delivered: number;
	day_key: string;
	created_at: string;
}

export interface RallyActionWithUser extends RallyActionRow {
	actor_discord_id: string;
	actor_username: string;
	actor_avatar: string | null;
}

export interface RallyActionWithDiscord extends RallyActionWithUser {
	target_discord_ids: string[] | null;
}

export interface TreeShareRow {
	id: string;
	requested_by: string;
	day_key: string;
	image_data: string | null;
	delivered: number;
	created_at: string;
}

// ---------- Day key ----------

export async function getDayKey(db: D1Database, nowDate?: Date): Promise<string> {
	const resetHour = ((await getSetting(db, 'day_reset_hour_et')) as number) ?? 8;
	const et = new Date((nowDate ?? new Date()).toLocaleString('en-US', { timeZone: 'America/New_York' }));
	if (et.getHours() < resetHour) {
		et.setDate(et.getDate() - 1);
	}
	const y = et.getFullYear();
	const m = String(et.getMonth() + 1).padStart(2, '0');
	const d = String(et.getDate()).padStart(2, '0');
	return `${y}-${m}-${d}`;
}

// ---------- Rally CRUD ----------

export async function createOrGetRally(
	db: D1Database,
	creatorId: string,
	timing: string = 'now',
	dayKey?: string,
): Promise<RallyRow> {
	const dk = dayKey ?? (await getDayKey(db));
	const existing = await db
		.prepare('SELECT * FROM rallies WHERE day_key = ?')
		.bind(dk)
		.first<RallyRow>();
	if (existing) return existing;

	const id = uuid();
	const timestamp = now();
	await db
		.prepare('INSERT INTO rallies (id, creator_id, timing, day_key, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
		.bind(id, creatorId, timing, dk, 'open', timestamp)
		.run();

	return { id, creator_id: creatorId, timing, day_key: dk, status: 'open', created_at: timestamp };
}

export async function getActiveRally(db: D1Database, dayKey?: string): Promise<RallyRow | null> {
	const dk = dayKey ?? (await getDayKey(db));
	return db
		.prepare('SELECT * FROM rallies WHERE day_key = ? AND status = ?')
		.bind(dk, 'open')
		.first<RallyRow>();
}

export async function closeRally(db: D1Database, rallyId: string): Promise<void> {
	await db.prepare("UPDATE rallies SET status = 'closed' WHERE id = ?").bind(rallyId).run();
}

// ---------- Rally Actions ----------

export async function createRallyAction(
	db: D1Database,
	actorId: string,
	actionType: ActionType,
	opts?: {
		rallyId?: string;
		targetUserIds?: string[];
		message?: string;
		metadata?: Record<string, unknown>;
		dayKey?: string;
	},
): Promise<RallyActionRow> {
	const id = uuid();
	const timestamp = now();
	const dk = opts?.dayKey ?? (await getDayKey(db));
	const targetIds = opts?.targetUserIds ? JSON.stringify(opts.targetUserIds) : null;
	const meta = opts?.metadata ? JSON.stringify(opts.metadata) : null;

	await db
		.prepare(
			'INSERT INTO rally_actions (id, rally_id, actor_id, action_type, target_user_ids, message, metadata, delivered, day_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)',
		)
		.bind(id, opts?.rallyId ?? null, actorId, actionType, targetIds, opts?.message ?? null, meta, dk, timestamp)
		.run();

	return {
		id,
		rally_id: opts?.rallyId ?? null,
		actor_id: actorId,
		action_type: actionType,
		target_user_ids: targetIds,
		message: opts?.message ?? null,
		metadata: meta,
		delivered: 0,
		day_key: dk,
		created_at: timestamp,
	};
}

export async function getRallyActions(db: D1Database, dayKey?: string): Promise<RallyActionWithUser[]> {
	const dk = dayKey ?? (await getDayKey(db));
	const result = await db
		.prepare(
			`SELECT ra.*, u.discord_id as actor_discord_id, u.discord_username as actor_username, u.avatar_url as actor_avatar
			FROM rally_actions ra
			JOIN users u ON ra.actor_id = u.id
			WHERE ra.day_key = ?
			ORDER BY ra.created_at ASC`,
		)
		.bind(dk)
		.all<RallyActionWithUser>();
	return result.results;
}

export async function getPendingRallyActions(db: D1Database): Promise<RallyActionWithDiscord[]> {
	const result = await db
		.prepare(
			`SELECT ra.*, u.discord_id as actor_discord_id, u.discord_username as actor_username, u.avatar_url as actor_avatar
			FROM rally_actions ra
			JOIN users u ON ra.actor_id = u.id
			WHERE ra.delivered = 0
			ORDER BY ra.created_at ASC`,
		)
		.all<RallyActionWithUser>();

	const actions: RallyActionWithDiscord[] = [];
	for (const row of result.results) {
		let target_discord_ids: string[] | null = null;
		if (row.target_user_ids) {
			const targetIds: string[] = JSON.parse(row.target_user_ids);
			const resolved: string[] = [];
			for (const id of targetIds) {
				const user = await db
					.prepare('SELECT discord_id FROM users WHERE id = ?')
					.bind(id)
					.first<{ discord_id: string }>();
				if (user) resolved.push(user.discord_id);
			}
			target_discord_ids = resolved;
		}
		actions.push({ ...row, target_discord_ids });
	}
	return actions;
}

export async function markActionDelivered(db: D1Database, actionId: string): Promise<void> {
	await db.prepare('UPDATE rally_actions SET delivered = 1 WHERE id = ?').bind(actionId).run();
}

// ---------- Tree Data ----------

export async function getTreeData(
	db: D1Database,
	dayKey?: string,
): Promise<{
	nodes: RallyActionWithUser[];
	edges: Array<{ source: string; target: string; type: 'response' | 'ping' | 'sequence' }>;
	rallies: RallyRow[];
	participants: Record<string, { username: string; avatar: string | null }>;
}> {
	const dk = dayKey ?? (await getDayKey(db));
	const nodes = await getRallyActions(db, dk);

	const ralliesResult = await db
		.prepare('SELECT * FROM rallies WHERE day_key = ?')
		.bind(dk)
		.all<RallyRow>();
	const rallies = ralliesResult.results;

	const edges: Array<{ source: string; target: string; type: 'response' | 'ping' | 'sequence' }> = [];

	// Build edges based on action relationships
	const actionsByRally = new Map<string, RallyActionWithUser[]>();
	for (const node of nodes) {
		const key = node.rally_id ?? '__orphan__';
		if (!actionsByRally.has(key)) actionsByRally.set(key, []);
		actionsByRally.get(key)!.push(node);
	}

	for (const [, actions] of actionsByRally) {
		let callNode: RallyActionWithUser | null = null;

		for (const action of actions) {
			if (action.action_type === 'call') {
				callNode = action;
				continue;
			}

			// Responses (in/out/brb) connect back to the call
			if (callNode && ['in', 'out', 'brb'].includes(action.action_type)) {
				edges.push({ source: callNode.id, target: action.id, type: 'response' });
			}

			// Ping/where connect from actor's action toward the target
			if (['ping', 'where'].includes(action.action_type) && action.target_user_ids) {
				if (callNode) {
					edges.push({ source: callNode.id, target: action.id, type: 'ping' });
				}
				// Find target's next response after this action
				const targetIds: string[] = JSON.parse(action.target_user_ids);
				for (const targetId of targetIds) {
					const targetResponse = actions.find(
						(a) =>
							a.actor_id === targetId &&
							['in', 'out', 'brb'].includes(a.action_type) &&
							a.created_at > action.created_at,
					);
					if (targetResponse) {
						edges.push({ source: action.id, target: targetResponse.id, type: 'ping' });
					}
				}
			}

			// Judge actions connect from the call
			if (['judge_time', 'judge_avail'].includes(action.action_type) && callNode) {
				edges.push({ source: callNode.id, target: action.id, type: 'sequence' });
			}
		}
	}

	// Build participants map from actor IDs and target user IDs
	const userIdSet = new Set<string>();
	for (const node of nodes) {
		userIdSet.add(node.actor_id);
		if (node.target_user_ids) {
			const targetIds: string[] = JSON.parse(node.target_user_ids);
			for (const id of targetIds) userIdSet.add(id);
		}
	}

	const participants: Record<string, { username: string; avatar: string | null }> = {};
	// Populate from already-joined actor data
	for (const node of nodes) {
		if (!participants[node.actor_id]) {
			participants[node.actor_id] = { username: node.actor_username, avatar: node.actor_avatar };
		}
	}
	// Fetch any target users not already covered
	const missingIds = Array.from(userIdSet).filter((id) => !participants[id]);
	if (missingIds.length > 0) {
		const ph = missingIds.map(() => '?').join(',');
		const usersResult = await db
			.prepare(`SELECT id, discord_username, avatar_url FROM users WHERE id IN (${ph})`)
			.bind(...missingIds)
			.all<{ id: string; discord_username: string; avatar_url: string | null }>();
		for (const u of usersResult.results) {
			participants[u.id] = { username: u.discord_username, avatar: u.avatar_url };
		}
	}

	return { nodes, edges, rallies, participants };
}

// ---------- Judge ----------

export async function computeJudgeTime(
	db: D1Database,
	dayKey?: string,
): Promise<{
	windows: Array<{ start: string; end: string; user_count: number; user_ids: string[] }>;
	day_key: string;
}> {
	const dk = dayKey ?? (await getDayKey(db));

	// Get availability for all users on this date (same as Schedule page overlap view)
	const availability = await db
		.prepare(
			`SELECT user_id, start_time, end_time FROM availability
			WHERE date = ?
			ORDER BY start_time ASC`,
		)
		.bind(dk)
		.all<{ user_id: string; start_time: string; end_time: string }>();

	if (availability.results.length === 0) {
		return { windows: [], day_key: dk };
	}

	// Collect all unique time boundaries
	const boundaries = new Set<string>();
	for (const slot of availability.results) {
		boundaries.add(slot.start_time);
		boundaries.add(slot.end_time);
	}
	const sorted = Array.from(boundaries).sort();

	// For each interval between consecutive boundaries, count overlapping users
	const windows: Array<{ start: string; end: string; user_count: number; user_ids: string[] }> = [];
	for (let i = 0; i < sorted.length - 1; i++) {
		const start = sorted[i];
		const end = sorted[i + 1];
		const overlapping = availability.results.filter(
			(slot: { user_id: string; start_time: string; end_time: string }) => slot.start_time <= start && slot.end_time >= end,
		);
		const overlapUserIds: string[] = Array.from(new Set(overlapping.map((s: { user_id: string }) => s.user_id)));
		if (overlapUserIds.length >= 2) {
			windows.push({ start, end, user_count: overlapUserIds.length, user_ids: overlapUserIds });
		}
	}

	// Merge adjacent windows with same users
	const merged: typeof windows = [];
	for (const w of windows) {
		const last = merged[merged.length - 1];
		if (
			last &&
			last.end === w.start &&
			last.user_count === w.user_count &&
			last.user_ids.join(',') === w.user_ids.join(',')
		) {
			last.end = w.end;
		} else {
			merged.push({ ...w });
		}
	}

	// Sort by user_count desc, then start asc
	merged.sort((a, b) => b.user_count - a.user_count || a.start.localeCompare(b.start));

	// Enrich with display names
	const allUserIds = Array.from(new Set(merged.flatMap((w) => w.user_ids)));
	const userNames = new Map<string, string>();
	if (allUserIds.length > 0) {
		const ph = allUserIds.map(() => '?').join(',');
		const usersResult = await db
			.prepare(`SELECT id, discord_username, display_name FROM users WHERE id IN (${ph})`)
			.bind(...allUserIds)
			.all<{ id: string; discord_username: string; display_name: string | null }>();
		for (const u of usersResult.results) {
			userNames.set(u.id, (u.display_name ?? u.discord_username).trim().replace(/\r?\n/g, ' '));
		}
	}

	const enriched = merged.map((w) => ({
		...w,
		user_names: w.user_ids.map((id) => userNames.get(id) ?? id),
	}));

	return { windows: enriched, day_key: dk };
}

// ---------- Tree Shares ----------

export async function createTreeShare(
	db: D1Database,
	userId: string,
	dayKey: string,
	imageData: string,
): Promise<TreeShareRow> {
	const id = uuid();
	const timestamp = now();
	await db
		.prepare(
			'INSERT INTO rally_tree_shares (id, requested_by, day_key, image_data, delivered, created_at) VALUES (?, ?, ?, ?, 0, ?)',
		)
		.bind(id, userId, dayKey, imageData, timestamp)
		.run();

	return { id, requested_by: userId, day_key: dayKey, image_data: imageData, delivered: 0, created_at: timestamp };
}

export async function getPendingTreeShares(db: D1Database): Promise<TreeShareRow[]> {
	const result = await db
		.prepare('SELECT * FROM rally_tree_shares WHERE delivered = 0 ORDER BY created_at ASC')
		.all<TreeShareRow>();
	return result.results;
}

export async function markTreeShareDelivered(db: D1Database, shareId: string): Promise<void> {
	await db.prepare('UPDATE rally_tree_shares SET delivered = 1 WHERE id = ?').bind(shareId).run();
}
