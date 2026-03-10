import type { D1Database } from '@cloudflare/workers-types';
import { uuid, now } from '../helpers';

export interface GameRow {
	id: string;
	name: string;
	steam_app_id: string | null;
	image_url: string | null;
	proposed_by: string;
	is_archived: number;
	created_at: string;
	archived_at: string | null;
	archive_reason: string | null;
	image_checked_at: string | null;
}

export async function createGame(
	db: D1Database,
	name: string,
	proposedBy: string,
	steamAppId?: string,
	imageUrl?: string,
): Promise<GameRow> {
	const id = uuid();
	const timestamp = now();
	const imageCheckedAt = steamAppId ? timestamp : null;

	await db
		.prepare('INSERT INTO games (id, name, steam_app_id, image_url, proposed_by, is_archived, created_at, image_checked_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)')
		.bind(id, name, steamAppId ?? null, imageUrl ?? null, proposedBy, timestamp, imageCheckedAt)
		.run();

	return { id, name, steam_app_id: steamAppId ?? null, image_url: imageUrl ?? null, proposed_by: proposedBy, is_archived: 0, created_at: timestamp, archived_at: null, archive_reason: null, image_checked_at: imageCheckedAt };
}

export async function getGames(db: D1Database, pool: 'active' | 'archive' | 'all' = 'active'): Promise<GameRow[]> {
	let query: string;
	if (pool === 'all') {
		query = 'SELECT * FROM games ORDER BY created_at DESC';
	} else if (pool === 'archive') {
		query = 'SELECT * FROM games WHERE is_archived = 1 ORDER BY created_at DESC';
	} else {
		query = 'SELECT * FROM games WHERE is_archived = 0 ORDER BY created_at DESC';
	}
	const result = await db.prepare(query).all<GameRow>();
	return result.results;
}

export async function getGameById(db: D1Database, id: string): Promise<GameRow | null> {
	return db.prepare('SELECT * FROM games WHERE id = ?').bind(id).first<GameRow>();
}

export async function updateGame(db: D1Database, id: string, updates: { name?: string; image_url?: string; image_checked_at?: string }): Promise<GameRow | null> {
	const setClauses: string[] = [];
	const values: unknown[] = [];

	if (updates.name !== undefined) {
		setClauses.push('name = ?');
		values.push(updates.name);
	}
	if (updates.image_url !== undefined) {
		setClauses.push('image_url = ?');
		values.push(updates.image_url);
	}
	if (updates.image_checked_at !== undefined) {
		setClauses.push('image_checked_at = ?');
		values.push(updates.image_checked_at);
	}

	if (setClauses.length === 0) return getGameById(db, id);

	values.push(id);
	await db.prepare(`UPDATE games SET ${setClauses.join(', ')} WHERE id = ?`).bind(...values).run();
	return getGameById(db, id);
}

export async function archiveGame(db: D1Database, id: string, reason?: string): Promise<void> {
	const timestamp = now();
	await db
		.prepare('UPDATE games SET is_archived = 1, archived_at = ?, archive_reason = ? WHERE id = ?')
		.bind(timestamp, reason ?? null, id)
		.run();
}

export async function restoreGame(db: D1Database, id: string): Promise<void> {
	await db.prepare('UPDATE games SET is_archived = 0, archived_at = NULL, archive_reason = NULL WHERE id = ?').bind(id).run();
}

export async function getGameBySteamAppId(db: D1Database, steamAppId: string): Promise<GameRow | null> {
	return db.prepare('SELECT * FROM games WHERE steam_app_id = ?').bind(steamAppId).first<GameRow>();
}
