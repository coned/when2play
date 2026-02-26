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
 * Convert a UTC HH:MM string to a local time string with timezone abbreviation.
 * Returns e.g. "2:00 PM ET".
 */
export function formatLocalTime(utcHHMM: string, dateStr: string): string {
	const utcDate = new Date(`${dateStr}T${utcHHMM}:00Z`);
	if (isNaN(utcDate.getTime())) return utcHHMM;
	const local = utcDate.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true });
	return `${local} ${getTimezoneAbbreviation()}`;
}

/**
 * Convert a UTC HH:MM string to local time only (no TZ code), e.g. "2:00 PM".
 */
export function utcToLocal(utcHHMM: string, dateStr: string): string {
	const utcDate = new Date(`${dateStr}T${utcHHMM}:00Z`);
	if (isNaN(utcDate.getTime())) return utcHHMM;
	return utcDate.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true });
}

/**
 * @deprecated Use formatLocalTime instead.
 */
export function formatDualTime(utcHHMM: string, dateStr: string): string {
	return formatLocalTime(utcHHMM, dateStr);
}
