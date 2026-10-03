/**
 * Maximum age of an undelivered bot item (rally action, tree share, game
 * share). Older rows are never handed to the bot: a bot that comes back after
 * an outage must not post a stale backlog to Discord. The aggregated poll
 * endpoint also marks such rows expired (delivered = 2) so they stop counting
 * as pending.
 */
export const PENDING_MAX_AGE_MS = 30 * 60 * 1000;

/** ISO cutoff timestamp; rows with created_at before it are stale. */
export function pendingCutoff(nowMs: number = Date.now()): string {
	return new Date(nowMs - PENDING_MAX_AGE_MS).toISOString();
}

/**
 * Values of the delivered column of the three delivery tables. Readers of
 * pending rows select delivered = 0; anything else is final.
 */
export const DELIVERY_STATE = {
	PENDING: 0,
	/** Acknowledged by the bot (posted to Discord). */
	DELIVERED: 1,
	/** Dropped unsent after PENDING_MAX_AGE_MS (set by the aggregated poll). */
	EXPIRED: 2,
} as const;

export type DeliveryStatus = 'pending' | 'delivered' | 'expired';

export function isDelivered(flag: number): boolean {
	return flag === DELIVERY_STATE.DELIVERED;
}

/** Status shown to users. A pending row past the cutoff counts as expired even before the poll marks it. */
export function deliveryStatus(flag: number, createdAt: string, nowMs: number = Date.now()): DeliveryStatus {
	if (flag === DELIVERY_STATE.DELIVERED) return 'delivered';
	if (flag === DELIVERY_STATE.EXPIRED) return 'expired';
	return createdAt < pendingCutoff(nowMs) ? 'expired' : 'pending';
}
