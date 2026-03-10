/**
 * Get today's date in YYYY-MM-DD format using the user's local timezone.
 * (Using toISOString().split('T')[0] returns the UTC date, which is wrong
 * for users west of UTC after midnight UTC.)
 */
export function localToday(): string {
	return new Date().toLocaleDateString('en-CA');
}

/**
 * Get the user's local timezone string (e.g. "America/New_York")
 */
export function getUserTimezone(): string {
	return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Get a short timezone abbreviation, e.g. "EST", "EDT", "PST".
 */
export function getTimezoneAbbreviation(): string {
	return (
		new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' })
			.formatToParts(new Date())
			.find((p) => p.type === 'timeZoneName')?.value ?? getUserTimezone()
	);
}

/**
 * Check if a UTC HH:MM on a given date falls on the next local calendar day.
 */
export function isNextDay(utcHHMM: string, dateStr: string): boolean {
	const utcDate = new Date(`${dateStr}T${utcHHMM}:00Z`);
	if (isNaN(utcDate.getTime())) return false;
	const localDateStr = utcDate.toLocaleDateString('en-CA'); // YYYY-MM-DD format
	return localDateStr !== dateStr;
}

/**
 * Convert a UTC HH:MM string to a local time string with timezone abbreviation.
 * Returns e.g. "2:00 PM ET" or "12:30 AM +1 ET" if it falls on the next day.
 */
export function formatLocalTime(utcHHMM: string, dateStr: string): string {
	const utcDate = new Date(`${dateStr}T${utcHHMM}:00Z`);
	if (isNaN(utcDate.getTime())) return utcHHMM;
	const local = utcDate.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true });
	const suffix = isNextDay(utcHHMM, dateStr) ? ' +1' : '';
	return `${local}${suffix} ${getTimezoneAbbreviation()}`;
}

/**
 * Convert a UTC HH:MM string to local time only (no TZ code), e.g. "2:00 PM".
 * Appends "+1" if the slot crosses into the next local day.
 */
export function utcToLocal(utcHHMM: string, dateStr: string): string {
	const utcDate = new Date(`${dateStr}T${utcHHMM}:00Z`);
	if (isNaN(utcDate.getTime())) return utcHHMM;
	const local = utcDate.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true });
	const suffix = isNextDay(utcHHMM, dateStr) ? ' +1' : '';
	return `${local}${suffix}`;
}

/**
 * Format a UTC time range as a local time range string.
 * Returns e.g. "5:00 PM – 6:30 PM ET" or "11:00 PM – 1:00 AM +1 ET".
 */
export function formatLocalTimeRange(startUTC: string, endUTC: string, dateStr: string): string {
	const startDate = new Date(`${dateStr}T${startUTC}:00Z`);
	const endDate = new Date(`${dateStr}T${endUTC}:00Z`);
	if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return `${startUTC} – ${endUTC}`;

	const startLocal = startDate.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true });
	const endLocal = endDate.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true });
	const startSuffix = isNextDay(startUTC, dateStr) ? ' +1' : '';
	const endSuffix = isNextDay(endUTC, dateStr) ? ' +1' : '';

	return `${startLocal}${startSuffix} – ${endLocal}${endSuffix} ${getTimezoneAbbreviation()}`;
}

/**
 * Compute the day offset of a UTC HH:MM slot relative to today's local date.
 * Returns 0 for today, +1 for tomorrow, -1 for yesterday, etc.
 */
export function getDayOffset(utcHHMM: string, dateStr: string): number {
	const utcDate = new Date(`${dateStr}T${utcHHMM}:00Z`);
	if (isNaN(utcDate.getTime())) return 0;
	const localDateStr = utcDate.toLocaleDateString('en-CA');
	const localToday = new Date().toLocaleDateString('en-CA');
	const diff = (new Date(localDateStr + 'T12:00:00Z').getTime() - new Date(localToday + 'T12:00:00Z').getTime()) / (86400000);
	return Math.round(diff);
}

export interface TimeRangeParts {
	startTime: string;
	startDayOffset: number;
	endTime: string;
	endDayOffset: number;
	tz: string;
}

/**
 * Format a UTC time range into structured parts for custom rendering.
 * Day offsets are relative to the start time's local date (not today),
 * so midnight-crossing ranges correctly show +1 on the end time.
 */
export function formatLocalTimeRangeStructured(startUTC: string, endUTC: string, dateStr: string): TimeRangeParts {
	const startDate = new Date(`${dateStr}T${startUTC}:00Z`);
	const endDate = new Date(`${dateStr}T${endUTC}:00Z`);
	const fallback = { startTime: startUTC, startDayOffset: 0, endTime: endUTC, endDayOffset: 0, tz: '' };
	if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return fallback;

	const startLocalDate = startDate.toLocaleDateString('en-CA');
	const endLocalDate = endDate.toLocaleDateString('en-CA');
	const endDayDiff = Math.round(
		(new Date(endLocalDate + 'T12:00:00Z').getTime() - new Date(startLocalDate + 'T12:00:00Z').getTime()) / 86400000,
	);

	return {
		startTime: startDate.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true }),
		startDayOffset: 0,
		endTime: endDate.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true }),
		endDayOffset: endDayDiff,
		tz: getTimezoneAbbreviation(),
	};
}

/**
 * Convert a UTC HH:MM string to a local time string with timezone abbreviation,
 * without any day offset indicator. Use when the date context is already known.
 */
export function formatLocalTimeClean(utcHHMM: string, dateStr: string): string {
	const utcDate = new Date(`${dateStr}T${utcHHMM}:00Z`);
	if (isNaN(utcDate.getTime())) return utcHHMM;
	const local = utcDate.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true });
	return `${local} ${getTimezoneAbbreviation()}`;
}

/**
 * Get "today" for availability purposes, respecting a day cutoff hour in ET.
 * Before the cutoff hour (ET), "today" still means yesterday's date,
 * because the gaming session hasn't ended yet.
 */
export function availabilityToday(cutoffHourET: number): string {
	const et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
	if (et.getHours() < cutoffHourET) {
		et.setDate(et.getDate() - 1);
	}
	const y = et.getFullYear();
	const m = String(et.getMonth() + 1).padStart(2, '0');
	const d = String(et.getDate()).padStart(2, '0');
	return `${y}-${m}-${d}`;
}

/**
 * Get "tomorrow" for availability purposes, one day after availabilityToday.
 */
export function availabilityTomorrow(cutoffHourET: number): string {
	const todayStr = availabilityToday(cutoffHourET);
	const d = new Date(todayStr + 'T12:00:00Z');
	d.setDate(d.getDate() + 1);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Generate an array of YYYY-MM-DD date strings starting from availabilityToday
 * for a given number of consecutive days.
 */
export function availabilityDateRange(cutoffHourET: number, days: number): string[] {
	const start = availabilityToday(cutoffHourET);
	const dates: string[] = [];
	const d = new Date(start + 'T12:00:00Z');
	for (let i = 0; i < days; i++) {
		const y = d.getUTCFullYear();
		const m = String(d.getUTCMonth() + 1).padStart(2, '0');
		const day = String(d.getUTCDate()).padStart(2, '0');
		dates.push(`${y}-${m}-${day}`);
		d.setUTCDate(d.getUTCDate() + 1);
	}
	return dates;
}

/**
 * @deprecated Use formatLocalTime instead.
 */
export function formatDualTime(utcHHMM: string, dateStr: string): string {
	return formatLocalTime(utcHHMM, dateStr);
}
