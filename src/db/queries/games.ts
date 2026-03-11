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
	note: string | null;
	last_activity_at: string | null;
}

export async function createGame(
	db: D1Database,
	name: string,
	proposedBy: string,
	steamAppId?: string,
	imageUrl?: string,
	note?: string,
): Promise<GameRow> {
	const id = uuid();
	const timestamp = now();
	const imageCheckedAt = steamAppId ? timestamp : null;

	await db
		.prepare('INSERT INTO games (id, name, steam_app_id, image_url, proposed_by, is_archived, created_at, image_checked_at, note, last_activity_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?)')
		.bind(id, name, steamAppId ?? null, imageUrl ?? null, proposedBy, timestamp, imageCheckedAt, note ?? null, timestamp)
		.run();

	return { id, name, steam_app_id: steamAppId ?? null, image_url: imageUrl ?? null, proposed_by: proposedBy, is_archived: 0, created_at: timestamp, archived_at: null, archive_reason: null, image_checked_at: imageCheckedAt, note: note ?? null, last_activity_at: timestamp };
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

export async function updateGame(db: D1Database, id: string, updates: { name?: string; image_url?: string; image_checked_at?: string; note?: string }): Promise<GameRow | null> {
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
	if (updates.note !== undefined) {
		setClauses.push('note = ?');
		values.push(updates.note);
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
	const timestamp = now();
	await db
		.prepare('UPDATE games SET is_archived = 0, archived_at = NULL, archive_reason = NULL, last_activity_at = ? WHERE id = ?')
		.bind(timestamp, id)
		.run();
}

export async function deleteGamePermanently(db: D1Database, id: string): Promise<void> {
	await db.prepare('DELETE FROM game_reactions WHERE game_id = ?').bind(id).run();
	await db.prepare('DELETE FROM game_activity WHERE game_id = ?').bind(id).run();
	await db.prepare('DELETE FROM game_shares WHERE game_id = ?').bind(id).run();
	await db.prepare('DELETE FROM games WHERE id = ?').bind(id).run();
}

export async function touchGameActivity(db: D1Database, id: string): Promise<void> {
	const timestamp = now();
	await db.prepare('UPDATE games SET last_activity_at = ? WHERE id = ?').bind(timestamp, id).run();
}

export async function autoArchiveStaleGames(db: D1Database, lifespanDays: number): Promise<number> {
	const cutoff = new Date(Date.now() - lifespanDays * 86400000).toISOString();
	const timestamp = now();
	const result = await db
		.prepare('UPDATE games SET is_archived = 1, archived_at = ?, archive_reason = ? WHERE is_archived = 0 AND COALESCE(last_activity_at, created_at) < ?')
		.bind(timestamp, 'auto_archived', cutoff)
		.run();
	return result.meta?.changes ?? 0;
}

export async function getGameBySteamAppId(db: D1Database, steamAppId: string): Promise<GameRow | null> {
	return db.prepare('SELECT * FROM games WHERE steam_app_id = ?').bind(steamAppId).first<GameRow>();
}

// --- Game shares for Discord broadcast ---

export interface GameShareRow {
	id: string;
	game_id: string;
	requested_by: string;
	delivered: number;
	created_at: string;
}

export async function createGameShare(db: D1Database, gameId: string, userId: string): Promise<GameShareRow> {
	const id = uuid();
	const timestamp = now();
	await db
		.prepare('INSERT INTO game_shares (id, game_id, requested_by, delivered, created_at) VALUES (?, ?, ?, 0, ?)')
		.bind(id, gameId, userId, timestamp)
		.run();
	return { id, game_id: gameId, requested_by: userId, delivered: 0, created_at: timestamp };
}

export async function getPendingGameShares(db: D1Database): Promise<Array<GameShareRow & { game_name: string; game_note: string | null; game_image_url: string | null; game_steam_app_id: string | null; like_count: number; dislike_count: number; requester_name: string }>> {
	const result = await db
		.prepare(`
			SELECT gs.*, g.name as game_name, g.note as game_note, g.image_url as game_image_url, g.steam_app_id as game_steam_app_id,
				(SELECT COUNT(*) FROM game_reactions gr WHERE gr.game_id = gs.game_id AND gr.type = 'like') as like_count,
				(SELECT COUNT(*) FROM game_reactions gr WHERE gr.game_id = gs.game_id AND gr.type = 'dislike') as dislike_count,
				COALESCE(u.display_name, u.discord_username) as requester_name
			FROM game_shares gs
			JOIN games g ON g.id = gs.game_id
			JOIN users u ON u.id = gs.requested_by
			WHERE gs.delivered = 0
			ORDER BY gs.created_at ASC
		`)
		.all();
	return result.results as any;
}

export async function markGameShareDelivered(db: D1Database, shareId: string): Promise<void> {
	await db.prepare('UPDATE game_shares SET delivered = 1 WHERE id = ?').bind(shareId).run();
}
