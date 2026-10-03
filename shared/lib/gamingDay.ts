/**
 * Gaming-day time helpers shared by the Worker and the frontend.
 *
 * Availability rows store `date` as the gaming day (ET based) and
 * `start_time`/`end_time` as UTC HH:MM strings without a day offset column.
 * The availability grid of a gaming day starts at the "grid origin" (the UTC
 * HH:MM of `avail_start_hour_et` on that date). Slots from the origin up to
 * 23:45 UTC fall on UTC date = `date`; slots from 00:00 UTC up to the origin
 * fall on UTC date = `date` + 1. When the grid range is not configured, the
 * origin is 00:00 UTC and every slot falls on `date`.
 *
 * Ordering and merging slots must use their offset from the origin, never a
 * lexicographic sort of HH:MM strings (which breaks at UTC midnight).
 */

export const MINUTES_PER_DAY = 24 * 60;

/** Parse "HH:MM" into minutes since midnight. */
export function hhmmToMinutes(hhmm: string): number {
	const [h, m] = hhmm.split(':').map(Number);
	return h * 60 + m;
}

/** Format minutes since midnight (any integer, wrapped to one day) as "HH:MM". */
export function minutesToHhmm(minutes: number): string {
	const total = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
	return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** Convert an ET hour to a UTC HH:MM slot for a given date, accounting for DST. */
export function etHourToUtcSlot(etHour: number, dateStr: string): string {
	const estimateUtcHour = (etHour + 5) % 24;
	const trial = new Date(`${dateStr}T${String(estimateUtcHour).padStart(2, '0')}:00:00Z`);

	const etStr = trial.toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false });
	const actualEtHour = parseInt(etStr, 10) % 24;

	const diff = ((etHour - actualEtHour) % 24 + 24) % 24;
	if (diff !== 0) {
		trial.setUTCHours(trial.getUTCHours() + diff);
	}

	const h = trial.getUTCHours();
	const m = trial.getUTCMinutes();
	return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Grid origin of a gaming day, in minutes after 00:00 UTC.
 * Matches the availability grid: the ET start hour converted to UTC when both
 * the start and end hour settings are defined, otherwise 00:00 UTC.
 */
export function gridOriginMinutes(dateStr: string, startHourET?: number | null, endHourET?: number | null): number {
	if (typeof startHourET !== 'number' || typeof endHourET !== 'number') return 0;
	return hhmmToMinutes(etHourToUtcSlot(startHourET, dateStr));
}

/** Offset in minutes, in [0, 1440), of a slot start "HH:MM" from the grid origin. */
export function slotStartOffset(hhmm: string, originMinutes: number): number {
	return (((hhmmToMinutes(hhmm) - originMinutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

/**
 * Offset in minutes, in (0, 1440], of a slot end "HH:MM" from the grid origin.
 * An end equal to the origin is the end of the gaming day (1440), not its start.
 */
export function slotEndOffset(hhmm: string, originMinutes: number): number {
	return slotStartOffset(hhmm, originMinutes + 1) + 1;
}

/** UTC calendar day offset (0 or 1) of a stored slot start relative to the gaming day `date`. */
export function slotDateOffset(hhmm: string, originMinutes: number): 0 | 1 {
	return hhmmToMinutes(hhmm) < originMinutes ? 1 : 0;
}

/** Real UTC instant of a gaming-day offset (minutes from the grid origin). */
export function offsetToInstant(dateStr: string, originMinutes: number, offset: number): Date {
	return new Date(Date.parse(`${dateStr}T00:00:00Z`) + (originMinutes + offset) * 60_000);
}

/** Real UTC instant of a stored slot start "HH:MM" on gaming day `date`. */
export function slotInstant(dateStr: string, hhmm: string, originMinutes: number): Date {
	return offsetToInstant(dateStr, originMinutes, slotStartOffset(hhmm, originMinutes));
}
