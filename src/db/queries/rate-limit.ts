/**
 * Per-user limits for everything that posts to Discord. They reuse the
 * settings of the deprecated gather bell (same keys, same defaults, 0
 * disables a check):
 * - gather_cooldown_seconds: the same user repeating the same kind of post
 * - gather_hourly_limit: rally actions per user in a rolling 60 minutes
 */
const DEFAULT_COOLDOWN_SECONDS = 10;
const DEFAULT_HOURLY_LIMIT = 30;
const HOUR_MS = 60 * 60 * 1000;

/** Delivery tables whose rows are rate limited by cooldown only (column = the requesting user). */
const SHARE_TABLES = {
	game_share: 'game_shares',
	tree_share: 'rally_tree_shares',
} as const;

export type ShareKind = keyof typeof SHARE_TABLES;

function settingNumber(raw: string | null | undefined, fallback: number): number {
	if (raw === null || raw === undefined) return fallback;
	const n = Number(raw);
	return Number.isFinite(n) ? n : fallback;
}

function cooldownMessage(lastIso: string | null, cooldownSeconds: number, nowMs: number): string | null {
	if (cooldownSeconds <= 0 || !lastIso) return null;
	const cooldownMs = cooldownSeconds * 1000;
	const elapsed = nowMs - new Date(lastIso).getTime();
	if (elapsed >= cooldownMs) return null;
	const remainingSeconds = Math.max(1, Math.ceil((cooldownMs - elapsed) / 1000));
	return `Cooldown active. Try again in ${remainingSeconds}s`;
}

/**
 * Check the rally limits for one user and action type. Returns the 429
 * message, or null when the action may proceed. One query: both settings,
 * the user's last action of this type and the 60 minute window.
 */
export async function checkRallyRateLimit(
	db: D1Database,
	userId: string,
	actionType: string,
	nowMs: number = Date.now(),
): Promise<string | null> {
	const sinceIso = new Date(nowMs - HOUR_MS).toISOString();
	const row = await db
		.prepare(
			`SELECT
				(SELECT value FROM settings WHERE key = 'gather_cooldown_seconds') AS cooldown,
				(SELECT value FROM settings WHERE key = 'gather_hourly_limit') AS hourly,
				(SELECT MAX(created_at) FROM rally_actions WHERE actor_id = ? AND action_type = ?) AS last_same,
				(SELECT COUNT(*) FROM rally_actions WHERE actor_id = ? AND created_at >= ?) AS recent_count,
				(SELECT MIN(created_at) FROM rally_actions WHERE actor_id = ? AND created_at >= ?) AS oldest_recent`,
		)
		.bind(userId, actionType, userId, sinceIso, userId, sinceIso)
		.first<{ cooldown: string | null; hourly: string | null; last_same: string | null; recent_count: number; oldest_recent: string | null }>();

	const hourlyLimit = settingNumber(row?.hourly, DEFAULT_HOURLY_LIMIT);
	if (hourlyLimit > 0 && Number(row?.recent_count ?? 0) >= hourlyLimit && row?.oldest_recent) {
		const lockoutEnds = new Date(row.oldest_recent).getTime() + HOUR_MS;
		const remainingSeconds = Math.max(1, Math.ceil((lockoutEnds - nowMs) / 1000));
		return `Hourly limit reached. Try again in ${remainingSeconds}s`;
	}

	return cooldownMessage(row?.last_same ?? null, settingNumber(row?.cooldown, DEFAULT_COOLDOWN_SECONDS), nowMs);
}

/** Cooldown (per user) for game and tree shares. Returns the 429 message or null. One query. */
export async function checkShareCooldown(
	db: D1Database,
	userId: string,
	kind: ShareKind,
	nowMs: number = Date.now(),
): Promise<string | null> {
	const row = await db
		.prepare(
			`SELECT
				(SELECT value FROM settings WHERE key = 'gather_cooldown_seconds') AS cooldown,
				(SELECT MAX(created_at) FROM ${SHARE_TABLES[kind]} WHERE requested_by = ?) AS last_same`,
		)
		.bind(userId)
		.first<{ cooldown: string | null; last_same: string | null }>();
	return cooldownMessage(row?.last_same ?? null, settingNumber(row?.cooldown, DEFAULT_COOLDOWN_SECONDS), nowMs);
}

/** Error body for a rate limited request (HTTP 429). */
export function rateLimited(message: string) {
	return { ok: false as const, error: { code: 'RATE_LIMITED', message } };
}
