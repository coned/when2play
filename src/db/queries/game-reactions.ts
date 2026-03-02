import type { D1Database } from '@cloudflare/workers-types';
import { now } from '../helpers';

export type ReactionType = 'like' | 'dislike';

export interface ReactionRow {
	game_id: string;
	user_id: string;
	type: ReactionType;
	created_at: string;
}

export interface ReactionCounts {
	like_count: number;
	dislike_count: number;
}

export interface ReactionUser {
	user_id: string;
	type: ReactionType;
	display_name: string | null;
	avatar_url: string | null;
}

export async function setReaction(db: D1Database, gameId: string, userId: string, type: ReactionType): Promise<void> {
	await db
		.prepare(
			`INSERT INTO game_reactions (game_id, user_id, type, created_at) VALUES (?, ?, ?, ?)
			ON CONFLICT(game_id, user_id) DO UPDATE SET type = excluded.type, created_at = excluded.created_at`,
		)
		.bind(gameId, userId, type, now())
		.run();
}

export async function removeReaction(db: D1Database, gameId: string, userId: string): Promise<void> {
	await db.prepare('DELETE FROM game_reactions WHERE game_id = ? AND user_id = ?').bind(gameId, userId).run();
}

export async function getReactionCountsForGames(db: D1Database): Promise<Map<string, ReactionCounts>> {
	const result = await db
		.prepare(
			`SELECT game_id, type, COUNT(*) as cnt FROM game_reactions GROUP BY game_id, type`,
		)
		.all<{ game_id: string; type: string; cnt: number }>();

	const map = new Map<string, ReactionCounts>();
	for (const row of result.results) {
		if (!map.has(row.game_id)) {
			map.set(row.game_id, { like_count: 0, dislike_count: 0 });
		}
		const counts = map.get(row.game_id)!;
		if (row.type === 'like') counts.like_count = row.cnt;
		else if (row.type === 'dislike') counts.dislike_count = row.cnt;
	}
	return map;
}

export async function getUserReactions(db: D1Database, userId: string): Promise<Map<string, ReactionType>> {
	const result = await db
		.prepare('SELECT game_id, type FROM game_reactions WHERE user_id = ?')
		.bind(userId)
		.all<{ game_id: string; type: ReactionType }>();

	const map = new Map<string, ReactionType>();
	for (const row of result.results) {
		map.set(row.game_id, row.type);
	}
	return map;
}

export async function getReactionUsersForGames(db: D1Database): Promise<Map<string, ReactionUser[]>> {
	const result = await db
		.prepare(
			`SELECT gr.game_id, gr.type, gr.user_id, u.display_name, u.avatar_url
			FROM game_reactions gr
			JOIN users u ON u.id = gr.user_id
			ORDER BY gr.created_at ASC`,
		)
		.all<ReactionUser & { game_id: string }>();

	const map = new Map<string, ReactionUser[]>();
	for (const row of result.results) {
		if (!map.has(row.game_id)) map.set(row.game_id, []);
		map.get(row.game_id)!.push({
			user_id: row.user_id,
			type: row.type,
			display_name: row.display_name,
			avatar_url: row.avatar_url,
		});
	}
	return map;
}

export async function getNetReactionScores(db: D1Database): Promise<Map<string, number>> {
	const result = await db
		.prepare(
			`SELECT game_id,
				SUM(CASE WHEN type = 'like' THEN 1 WHEN type = 'dislike' THEN -1 ELSE 0 END) as net_score
			FROM game_reactions
			GROUP BY game_id`,
		)
		.all<{ game_id: string; net_score: number }>();

	const map = new Map<string, number>();
	for (const row of result.results) {
		map.set(row.game_id, row.net_score);
	}
	return map;
}
