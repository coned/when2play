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

export interface TimeRangeParts {
	startTime: string;
	startNextDay: boolean;
	endTime: string;
	endNextDay: boolean;
	tz: string;
}

/**
 * Format a UTC time range into structured parts for custom rendering.
 * Allows callers to render +1 indicators separately (e.g. as colored superscripts).
 */
export function formatLocalTimeRangeStructured(startUTC: string, endUTC: string, dateStr: string): TimeRangeParts {
	const startDate = new Date(`${dateStr}T${startUTC}:00Z`);
	const endDate = new Date(`${dateStr}T${endUTC}:00Z`);
	const fallback = { startTime: startUTC, startNextDay: false, endTime: endUTC, endNextDay: false, tz: '' };
	if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) return fallback;

	return {
		startTime: startDate.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true }),
		startNextDay: isNextDay(startUTC, dateStr),
		endTime: endDate.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true }),
		endNextDay: isNextDay(endUTC, dateStr),
		tz: getTimezoneAbbreviation(),
	};
}

/**
 * @deprecated Use formatLocalTime instead.
 */
export function formatDualTime(utcHHMM: string, dateStr: string): string {
	return formatLocalTime(utcHHMM, dateStr);
}
