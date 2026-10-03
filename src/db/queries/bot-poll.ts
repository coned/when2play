import { pendingCutoff, DELIVERY_STATE } from '../../lib/pending';
import { BOT_HEARTBEAT_KEY, heartbeatDue, writeHeartbeat } from '../../lib/bot-status';
import {
	getPendingRallyActions,
	getPendingTreeShares,
	formatPendingRallyAction,
	formatPendingTreeShare,
} from './rally';
import { getPendingGameShares, formatPendingGameShare } from './games';

/** The three delivery queues the bot drains, keyed by their name in the poll API. */
export const DELIVERY_TABLES = {
	rally_actions: 'rally_actions',
	tree_shares: 'rally_tree_shares',
	game_shares: 'game_shares',
} as const;

export type DeliveryKind = keyof typeof DELIVERY_TABLES;

/**
 * Extra SET clause applied when a row is acknowledged or expired: the tree
 * share PNG is only needed until the bot posts it (or it is dropped).
 */
const CLEAR_ON_FINAL: Partial<Record<DeliveryKind, string>> = {
	tree_shares: ', image_data = NULL',
};

export const DELIVERY_KINDS = Object.keys(DELIVERY_TABLES) as DeliveryKind[];

export type GuildAcks = Partial<Record<DeliveryKind, string[]>>;

export interface GuildPending {
	rally_actions: ReturnType<typeof formatPendingRallyAction>[];
	tree_shares: ReturnType<typeof formatPendingTreeShare>[];
	game_shares: ReturnType<typeof formatPendingGameShare>[];
}

/** Max bound parameters per statement (D1 allows 100). */
const ACK_CHUNK_SIZE = 50;

/** Mark the given ids delivered (tree shares also drop their image). Idempotent; unknown ids are ignored. */
export async function applyAcks(db: D1Database, acks: GuildAcks): Promise<void> {
	const statements = [];
	for (const kind of DELIVERY_KINDS) {
		const ids = acks[kind];
		if (!ids || ids.length === 0) continue;
		const unique = Array.from(new Set(ids));
		for (let i = 0; i < unique.length; i += ACK_CHUNK_SIZE) {
			const chunk = unique.slice(i, i + ACK_CHUNK_SIZE);
			const ph = chunk.map(() => '?').join(',');
			statements.push(
				db.prepare(`UPDATE ${DELIVERY_TABLES[kind]} SET delivered = ${DELIVERY_STATE.DELIVERED}${CLEAR_ON_FINAL[kind] ?? ''} WHERE id IN (${ph})`).bind(...chunk),
			);
		}
	}
	if (statements.length > 0) await db.batch(statements);
}

export interface PollState {
	counts: Record<DeliveryKind, number>;
	/** Stored bot heartbeat (settings.bot_last_poll_at), or null. */
	lastPollAt: string | null;
}

/** Count undelivered rows of each kind and read the bot heartbeat, in a single statement. */
export async function readPollState(db: D1Database): Promise<PollState> {
	const row = await db
		.prepare(
			`SELECT
				(SELECT COUNT(*) FROM rally_actions WHERE delivered = 0) AS rally_actions,
				(SELECT COUNT(*) FROM rally_tree_shares WHERE delivered = 0) AS tree_shares,
				(SELECT COUNT(*) FROM game_shares WHERE delivered = 0) AS game_shares,
				(SELECT value FROM settings WHERE key = ?) AS last_poll_at`,
		)
		.bind(BOT_HEARTBEAT_KEY)
		.first<Record<DeliveryKind, number> & { last_poll_at: string | null }>();
	return {
		counts: {
			rally_actions: Number(row?.rally_actions ?? 0),
			tree_shares: Number(row?.tree_shares ?? 0),
			game_shares: Number(row?.game_shares ?? 0),
		},
		lastPollAt: row?.last_poll_at ?? null,
	};
}

/**
 * Mark undelivered rows older than the cutoff as expired (delivered = 2) so
 * they are never sent and can be told apart from delivered ones. Expired tree
 * shares also drop their image.
 */
export async function expireStalePending(db: D1Database, cutoff: string, kinds: DeliveryKind[] = DELIVERY_KINDS): Promise<void> {
	if (kinds.length === 0) return;
	await db.batch(
		kinds.map((kind) =>
			db.prepare(`UPDATE ${DELIVERY_TABLES[kind]} SET delivered = ${DELIVERY_STATE.EXPIRED}${CLEAR_ON_FINAL[kind] ?? ''} WHERE delivered = 0 AND created_at < ?`).bind(cutoff),
		),
	);
}

/**
 * One poll cycle for one guild: apply acks, record the bot heartbeat, then
 * return what is left to deliver, or null when the guild is idle. The idle
 * path costs one query plus, at most once per minute, the heartbeat write
 * (plus the ack statements, if any). Every step is idempotent, so the caller
 * may safely retry the whole function.
 */
export async function pollGuild(db: D1Database, acks: GuildAcks | undefined, nowMs: number = Date.now()): Promise<GuildPending | null> {
	if (acks) await applyAcks(db, acks);

	const { counts, lastPollAt } = await readPollState(db);
	if (heartbeatDue(lastPollAt, nowMs)) await writeHeartbeat(db, nowMs);
	const busy = DELIVERY_KINDS.filter((kind) => counts[kind] > 0);
	if (busy.length === 0) return null;

	const cutoff = pendingCutoff(nowMs);
	await expireStalePending(db, cutoff, busy);

	const [rallyActions, treeShares, gameShares] = await Promise.all([
		counts.rally_actions > 0 ? getPendingRallyActions(db, cutoff) : Promise.resolve([]),
		counts.tree_shares > 0 ? getPendingTreeShares(db, cutoff) : Promise.resolve([]),
		counts.game_shares > 0 ? getPendingGameShares(db, cutoff) : Promise.resolve([]),
	]);

	if (rallyActions.length === 0 && treeShares.length === 0 && gameShares.length === 0) return null;

	return {
		rally_actions: rallyActions.map(formatPendingRallyAction),
		tree_shares: treeShares.map(formatPendingTreeShare),
		game_shares: gameShares.map(formatPendingGameShare),
	};
}
