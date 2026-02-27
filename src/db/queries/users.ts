import type { D1Database } from '@cloudflare/workers-types';
import { uuid, now } from '../helpers';

export interface UserRow {
	id: string;
	discord_id: string;
	discord_username: string;
	display_name: string | null;
	sync_name_from_discord: number;
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
		// If sync_name_from_discord is enabled, update display_name to match discord_username
		const syncDisplay = existing.sync_name_from_discord ? discordUsername : existing.display_name;
		await db
			.prepare('UPDATE users SET discord_username = ?, display_name = ?, avatar_url = COALESCE(?, avatar_url), updated_at = ? WHERE id = ?')
			.bind(discordUsername, syncDisplay, avatarUrl ?? null, timestamp, existing.id)
			.run();
		return {
			...existing,
			discord_username: discordUsername,
			display_name: syncDisplay,
			avatar_url: avatarUrl ?? existing.avatar_url,
			updated_at: timestamp,
		};
	}

	const id = uuid();
	const timestamp = now();
	await db
		.prepare(
			'INSERT INTO users (id, discord_id, discord_username, display_name, sync_name_from_discord, avatar_url, timezone, time_granularity_minutes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
		)
		.bind(id, discordId, discordUsername, discordUsername, 1, avatarUrl ?? null, 'UTC', 15, timestamp, timestamp)
		.run();

	return {
		id,
		discord_id: discordId,
		discord_username: discordUsername,
		display_name: discordUsername,
		sync_name_from_discord: 1,
		avatar_url: avatarUrl ?? null,
		timezone: 'UTC',
		time_granularity_minutes: 15,
		created_at: timestamp,
		updated_at: timestamp,
	};
}

export async function getAllUsers(db: D1Database): Promise<Array<{ id: string; discord_username: string; display_name: string | null; avatar_url: string | null }>> {
	const result = await db
		.prepare('SELECT id, discord_username, display_name, avatar_url FROM users ORDER BY discord_username ASC')
		.all<{ id: string; discord_username: string; display_name: string | null; avatar_url: string | null }>();
	return result.results;
}

export async function getUserById(db: D1Database, id: string): Promise<UserRow | null> {
	return db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<UserRow>();
}

export async function updateUser(
	db: D1Database,
	id: string,
	updates: { discord_username?: string; display_name?: string; sync_name_from_discord?: number; timezone?: string; time_granularity_minutes?: number },
): Promise<UserRow | null> {
	const setClauses: string[] = [];
	const values: unknown[] = [];

	if (updates.discord_username !== undefined) {
		setClauses.push('discord_username = ?');
		values.push(updates.discord_username);
	}
	if (updates.display_name !== undefined) {
		setClauses.push('display_name = ?');
		values.push(updates.display_name);
	}
	if (updates.sync_name_from_discord !== undefined) {
		setClauses.push('sync_name_from_discord = ?');
		values.push(updates.sync_name_from_discord);
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
