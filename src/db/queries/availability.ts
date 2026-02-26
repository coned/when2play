import type { D1Database } from '@cloudflare/workers-types';
import { uuid, now } from '../helpers';

export interface AvailabilityRow {
	id: string;
	user_id: string;
	date: string;
	start_time: string;
	end_time: string;
	created_at: string;
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
	slots: Array<{ start_time: string; end_time: string }>,
): Promise<AvailabilityRow[]> {
	// Clear existing slots for this user+date
	await db.prepare('DELETE FROM availability WHERE user_id = ? AND date = ?').bind(userId, date).run();

	const timestamp = now();
	const results: AvailabilityRow[] = [];

	for (const slot of slots) {
		const id = uuid();
		await db
			.prepare('INSERT INTO availability (id, user_id, date, start_time, end_time, created_at) VALUES (?, ?, ?, ?, ?, ?)')
			.bind(id, userId, date, slot.start_time, slot.end_time, timestamp)
			.run();
		results.push({ id, user_id: userId, date, start_time: slot.start_time, end_time: slot.end_time, created_at: timestamp });
	}

	return results;
}

export async function clearAvailability(db: D1Database, userId: string, date: string): Promise<void> {
	await db.prepare('DELETE FROM availability WHERE user_id = ? AND date = ?').bind(userId, date).run();
}
