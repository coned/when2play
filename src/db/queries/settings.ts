import type { D1Database } from '@cloudflare/workers-types';
import { now } from '../helpers';

export interface SettingRow {
	key: string;
	value: string;
	updated_at: string;
}

export async function getAllSettings(db: D1Database): Promise<Record<string, unknown>> {
	const result = await db.prepare('SELECT * FROM settings').all<SettingRow>();
	const settings: Record<string, unknown> = {};

	for (const row of result.results) {
		try {
			settings[row.key] = JSON.parse(row.value);
		} catch {
			settings[row.key] = row.value;
		}
	}

	return settings;
}

export async function getSetting(db: D1Database, key: string): Promise<unknown | null> {
	const row = await db.prepare('SELECT * FROM settings WHERE key = ?').bind(key).first<SettingRow>();
	if (!row) return null;

	try {
		return JSON.parse(row.value);
	} catch {
		return row.value;
	}
}

export async function updateSettings(db: D1Database, updates: Record<string, unknown>): Promise<Record<string, unknown>> {
	const timestamp = now();

	for (const [key, value] of Object.entries(updates)) {
		const serialized = typeof value === 'string' ? value : JSON.stringify(value);
		await db
			.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?')
			.bind(key, serialized, timestamp, serialized, timestamp)
			.run();
	}

	return getAllSettings(db);
}
