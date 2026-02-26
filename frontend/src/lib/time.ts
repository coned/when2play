/**
 * Get the user's local timezone string (e.g. "America/New_York")
 */
export function getUserTimezone(): string {
	return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * Convert a UTC HH:MM string to a local time string for a given date.
 * Returns formatted local time like "2:00 PM".
 *
 * @param utcHHMM - Time in "HH:MM" format (UTC)
 * @param dateStr - ISO date string "YYYY-MM-DD"
 */
export function utcToLocal(utcHHMM: string, dateStr: string): string {
	const [h, m] = utcHHMM.split(':').map(Number);
	const utcDate = new Date(`${dateStr}T${utcHHMM}:00Z`);

	// Handle cases where the UTC time is valid
	if (isNaN(utcDate.getTime())) return utcHHMM;

	return utcDate.toLocaleTimeString(undefined, {
		hour: 'numeric',
		minute: '2-digit',
		hour12: true,
	});
}

/**
 * Format a dual-timezone string: "19:00 UTC / 2:00 PM"
 */
export function formatDualTime(utcHHMM: string, dateStr: string): string {
	const local = utcToLocal(utcHHMM, dateStr);
	return `${utcHHMM} UTC / ${local}`;
}
