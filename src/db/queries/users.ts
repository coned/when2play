import type { D1Database } from '@cloudflare/workers-types';
import { uuid, now } from '../helpers';

export interface UserRow {
	id: string;
	discord_id: string;
	discord_username: string;
	avatar_url: string | null;
	timezone: string;
	time_granularity_minutes: number;
	created_at: string;
	updated_at: string;
}

export async function upsertUser(
	db: D1Database,
	discordId: string,
	discordUsername: string,
	avatarUrl?: string,
): Promise<UserRow> {
	const existing = await db.prepare('SELECT * FROM users WHERE discord_id = ?').bind(discordId).first<UserRow>();

	if (existing) {
		const timestamp = now();
		await db
			.prepare('UPDATE users SET discord_username = ?, avatar_url = COALESCE(?, avatar_url), updated_at = ? WHERE id = ?')
			.bind(discordUsername, avatarUrl ?? null, timestamp, existing.id)
			.run();
		return { ...existing, discord_username: discordUsername, avatar_url: avatarUrl ?? existing.avatar_url, updated_at: timestamp };
	}

	const id = uuid();
	const timestamp = now();
	await db
		.prepare(
			'INSERT INTO users (id, discord_id, discord_username, avatar_url, timezone, time_granularity_minutes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
		)
		.bind(id, discordId, discordUsername, avatarUrl ?? null, 'UTC', 15, timestamp, timestamp)
		.run();

	return {
		id,
		discord_id: discordId,
		discord_username: discordUsername,
		avatar_url: avatarUrl ?? null,
		timezone: 'UTC',
		time_granularity_minutes: 15,
		created_at: timestamp,
		updated_at: timestamp,
	};
}

export async function getUserById(db: D1Database, id: string): Promise<UserRow | null> {
	return db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>();
}

export async function updateUser(
	db: D1Database,
	id: string,
	updates: { discord_username?: string; timezone?: string; time_granularity_minutes?: number },
): Promise<UserRow | null> {
	const setClauses: string[] = [];
	const values: unknown[] = [];

	if (updates.discord_username !== undefined) {
		setClauses.push('discord_username = ?');
		values.push(updates.discord_username);
	}
	if (updates.timezone !== undefined) {
		setClauses.push('timezone = ?');
		values.push(updates.timezone);
	}
	if (updates.time_granularity_minutes !== undefined) {
		setClauses.push('time_granularity_minutes = ?');
		values.push(updates.time_granularity_minutes);
	}

	if (setClauses.length === 0) return getUserById(db, id);

	const timestamp = now();
	setClauses.push('updated_at = ?');
	values.push(timestamp);
	values.push(id);

	await db.prepare(`UPDATE users SET ${setClauses.join(', ')} WHERE id = ?`).bind(...values).run();

	return getUserById(db, id);
}
