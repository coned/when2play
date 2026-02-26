/**
 * Generate 15-min time slots for a given time range.
 */
export function generateSlots(
	startHour: number,
	endHour: number,
	granularityMinutes: number = 15,
): Array<{ start_time: string; end_time: string }> {
	const slots: Array<{ start_time: string; end_time: string }> = [];
	let currentMinutes = startHour * 60;
	const endMinutes = endHour * 60;

	while (currentMinutes < endMinutes) {
		const nextMinutes = currentMinutes + granularityMinutes;
		slots.push({
			start_time: minutesToTime(currentMinutes),
			end_time: minutesToTime(nextMinutes),
		});
		currentMinutes = nextMinutes;
	}

	return slots;
}

export function minutesToTime(totalMinutes: number): string {
	const hours = Math.floor(totalMinutes / 60) % 24;
	const minutes = totalMinutes % 60;
	return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

export function timeToMinutes(time: string): number {
	const [hours, minutes] = time.split(':').map(Number);
	return hours * 60 + minutes;
}

export function todayUTC(): string {
	return new Date().toISOString().split('T')[0];
}

export function tomorrowUTC(): string {
	const d = new Date();
	d.setUTCDate(d.getUTCDate() + 1);
	return d.toISOString().split('T')[0];
}
