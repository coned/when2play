import { getSetting } from '../db/queries/settings';

/**
 * Bot liveness. Every aggregated poll (POST /api/bot/poll) records its time in
 * the polled guild's settings table, at most once per BOT_HEARTBEAT_INTERVAL_MS.
 * The bot only polls guilds that have an output channel, so a stale heartbeat
 * means "bot offline" or "no channel set with /setchannel".
 */
export const BOT_HEARTBEAT_KEY = 'bot_last_poll_at';
export const BOT_HEARTBEAT_INTERVAL_MS = 60 * 1000;
/** The bot polls every 15 s and backs off to at most 2 minutes on errors. */
export const BOT_ONLINE_WINDOW_MS = 3 * 60 * 1000;

/** Settings that are written by the server and must not be shown or edited as admin settings. */
export const INTERNAL_SETTING_KEYS: ReadonlySet<string> = new Set([BOT_HEARTBEAT_KEY]);

export interface BotStatus {
	online: boolean;
	last_seen_at: string | null;
}

function parseIso(value: unknown): number | null {
	if (typeof value !== 'string' || !value) return null;
	const ms = Date.parse(value);
	return Number.isNaN(ms) ? null : ms;
}

/** Whether a poll at nowMs must rewrite the heartbeat (missing, unreadable, older than the interval, or in the future). */
export function heartbeatDue(lastPollAt: unknown, nowMs: number): boolean {
	const last = parseIso(lastPollAt);
	if (last === null) return true;
	const age = nowMs - last;
	return age < 0 || age >= BOT_HEARTBEAT_INTERVAL_MS;
}

export function botStatusFrom(lastPollAt: unknown, nowMs: number = Date.now()): BotStatus {
	const last = parseIso(lastPollAt);
	if (last === null) return { online: false, last_seen_at: null };
	return { online: nowMs - last < BOT_ONLINE_WINDOW_MS, last_seen_at: new Date(last).toISOString() };
}

/** Bot status of the current guild. One settings read. */
export async function getBotStatus(db: D1Database, nowMs: number = Date.now()): Promise<BotStatus> {
	return botStatusFrom(await getSetting(db, BOT_HEARTBEAT_KEY), nowMs);
}

export async function writeHeartbeat(db: D1Database, nowMs: number): Promise<void> {
	const iso = new Date(nowMs).toISOString();
	await db
		.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
		.bind(BOT_HEARTBEAT_KEY, iso, iso)
		.run();
}
