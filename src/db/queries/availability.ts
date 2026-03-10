import type { D1Database } from '@cloudflare/workers-types';
import { uuid, now } from '../helpers';

export interface AvailabilityRow {
	id: string;
	user_id: string;
	date: string;
	start_time: string;
	end_time: string;
	created_at: string;
	slot_status: string;
}

export async function getAvailability(db: D1Database, filters: { user_id?: string; date?: string }): Promise<AvailabilityRow[]> {
	let query = 'SELECT * FROM availability WHERE 1=1';
	const bindings: unknown[] = [];

	if (filters.user_id) {
		query += ' AND user_id = ?';
		bindings.push(filters.user_id);
	}
	if (filters.date) {
		query += ' AND date = ?';
		bindings.push(filters.date);
	}

	query += ' ORDER BY date ASC, start_time ASC';

	const result = await db.prepare(query).bind(...bindings).all<AvailabilityRow>();
	return result.results;
}

export async function setAvailability(
	db: D1Database,
	userId: string,
	date: string,
	slots: Array<{ start_time: string; end_time: string; slot_status?: string }>,
): Promise<AvailabilityRow[]> {
	// Clear existing slots for this user+date
	await db.prepare('DELETE FROM availability WHERE user_id = ? AND date = ?').bind(userId, date).run();

	const timestamp = now();
	const results: AvailabilityRow[] = [];

	for (const slot of slots) {
		const id = uuid();
		const slotStatus = slot.slot_status ?? 'available';
		try {
			await db
				.prepare('INSERT INTO availability (id, user_id, date, start_time, end_time, created_at, slot_status) VALUES (?, ?, ?, ?, ?, ?, ?)')
				.bind(id, userId, date, slot.start_time, slot.end_time, timestamp, slotStatus)
				.run();
		} catch {
			await db
				.prepare('INSERT INTO availability (id, user_id, date, start_time, end_time, created_at) VALUES (?, ?, ?, ?, ?, ?)')
				.bind(id, userId, date, slot.start_time, slot.end_time, timestamp)
				.run();
		}
		results.push({ id, user_id: userId, date, start_time: slot.start_time, end_time: slot.end_time, created_at: timestamp, slot_status: slotStatus });
	}

	// Mark as manual so auto-fill won't override user action
	await upsertAvailabilityStatus(db, userId, date, 'manual');

	return results;
}

export async function clearAvailability(db: D1Database, userId: string, date: string): Promise<void> {
	await db.prepare('DELETE FROM availability WHERE user_id = ? AND date = ?').bind(userId, date).run();
	// Mark as manual so auto-fill won't re-appear after clearing
	await upsertAvailabilityStatus(db, userId, date, 'manual');
}

// --- Availability status queries ---

export interface AvailabilityStatusRow {
	user_id: string;
	date: string;
	status: string; // 'confirmed' | 'manual'
	created_at: string;
}

export async function getAvailabilityStatus(
	db: D1Database,
	userId: string,
	dates: string[],
): Promise<AvailabilityStatusRow[]> {
	if (dates.length === 0) return [];
	try {
		const placeholders = dates.map(() => '?').join(', ');
		const result = await db
			.prepare(`SELECT * FROM availability_status WHERE user_id = ? AND date IN (${placeholders})`)
			.bind(userId, ...dates)
			.all<AvailabilityStatusRow>();
		return result.results;
	} catch {
		return [];
	}
}

export async function upsertAvailabilityStatus(
	db: D1Database,
	userId: string,
	date: string,
	status: string,
): Promise<void> {
	try {
		const timestamp = now();
		await db
			.prepare(
				'INSERT INTO availability_status (user_id, date, status, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (user_id, date) DO UPDATE SET status = excluded.status, created_at = excluded.created_at',
			)
			.bind(userId, date, status, timestamp)
			.run();
	} catch {
		// Table may not exist yet (migration not applied)
	}
}

export async function getLastWeekSlots(
	db: D1Database,
	targetDate: string,
	excludeUserIds: string[],
): Promise<AvailabilityRow[]> {
	// Compute date - 7 days
	const d = new Date(targetDate + 'T12:00:00Z');
	d.setUTCDate(d.getUTCDate() - 7);
	const lastWeekDate = d.toISOString().split('T')[0];

	let query = 'SELECT * FROM availability WHERE date = ?';
	const bindings: unknown[] = [lastWeekDate];

	if (excludeUserIds.length > 0) {
		const placeholders = excludeUserIds.map(() => '?').join(', ');
		query += ` AND user_id NOT IN (${placeholders})`;
		bindings.push(...excludeUserIds);
	}

	query += ' ORDER BY user_id ASC, start_time ASC';
	const result = await db.prepare(query).bind(...bindings).all<AvailabilityRow>();
	return result.results;
}

export async function getAvailabilityStatusForDate(
	db: D1Database,
	date: string,
): Promise<AvailabilityStatusRow[]> {
	try {
		const result = await db
			.prepare('SELECT * FROM availability_status WHERE date = ?')
			.bind(date)
			.all<AvailabilityStatusRow>();
		return result.results;
	} catch {
		return [];
	}
}

export async function getDatesWithTentativeSlots(
	db: D1Database,
	userId: string,
	dates: string[],
): Promise<Set<string>> {
	if (dates.length === 0) return new Set();
	try {
		const placeholders = dates.map(() => '?').join(', ');
		const result = await db
			.prepare(`SELECT DISTINCT date FROM availability WHERE user_id = ? AND date IN (${placeholders}) AND slot_status = 'tentative'`)
			.bind(userId, ...dates)
			.all<{ date: string }>();
		return new Set(result.results.map((r: { date: string }) => r.date));
	} catch {
		// slot_status column may not exist yet
		return new Set();
	}
}

export async function getDistinctAvailabilityDates(
	db: D1Database,
	userId: string,
	dates: string[],
): Promise<string[]> {
	if (dates.length === 0) return [];
	const placeholders = dates.map(() => '?').join(', ');
	const result = await db
		.prepare(`SELECT DISTINCT date FROM availability WHERE user_id = ? AND date IN (${placeholders})`)
		.bind(userId, ...dates)
		.all<{ date: string }>();
	return result.results.map((r: { date: string }) => r.date);
}
