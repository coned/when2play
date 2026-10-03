/**
 * Maximum age of an undelivered bot item (rally action, tree share, game
 * share). Older rows are never handed to the bot: a bot that comes back after
 * an outage must not post a stale backlog to Discord. The aggregated poll
 * endpoint also marks such rows delivered so they stop counting as pending.
 */
export const PENDING_MAX_AGE_MS = 30 * 60 * 1000;

/** ISO cutoff timestamp; rows with created_at before it are stale. */
export function pendingCutoff(nowMs: number = Date.now()): string {
	return new Date(nowMs - PENDING_MAX_AGE_MS).toISOString();
}
