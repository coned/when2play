import type { D1Database } from '@cloudflare/workers-types';
import { uuid, now } from '../helpers';

export interface VoteRow {
	id: string;
	game_id: string;
	user_id: string;
	rank: number;
	is_approved: number;
	created_at: string;
}

export interface RankingRow {
	game_id: string;
	name: string;
	steam_app_id: string | null;
	image_url: string | null;
	proposed_by: string;
	total_score: number;
	vote_count: number;
	like_count: number;
}

export async function setVote(db: D1Database, gameId: string, userId: string, rank: number, isApproved: boolean = true): Promise<VoteRow> {
	const existing = await db.prepare('SELECT * FROM game_votes WHERE game_id = ? AND user_id = ?').bind(gameId, userId).first<VoteRow>();

	if (existing) {
		await db
			.prepare('UPDATE game_votes SET rank = ?, is_approved = ? WHERE id = ?')
			.bind(rank, isApproved ? 1 : 0, existing.id)
			.run();
		return { ...existing, rank, is_approved: isApproved ? 1 : 0 };
	}

	const id = uuid();
	const timestamp = now();
	await db
		.prepare('INSERT INTO game_votes (id, game_id, user_id, rank, is_approved, created_at) VALUES (?, ?, ?, ?, ?, ?)')
		.bind(id, gameId, userId, rank, isApproved ? 1 : 0, timestamp)
		.run();

	return { id, game_id: gameId, user_id: userId, rank, is_approved: isApproved ? 1 : 0, created_at: timestamp };
}

export async function deleteVote(db: D1Database, gameId: string, userId: string): Promise<boolean> {
	const result = await db.prepare('DELETE FROM game_votes WHERE game_id = ? AND user_id = ?').bind(gameId, userId).run();
	return true;
}

export async function getVotesForGame(db: D1Database, gameId: string): Promise<VoteRow[]> {
	const result = await db.prepare('SELECT * FROM game_votes WHERE game_id = ? ORDER BY rank ASC').bind(gameId).all<VoteRow>();
	return result.results;
}

export async function getUserVotes(db: D1Database, userId: string): Promise<VoteRow[]> {
	const result = await db.prepare('SELECT * FROM game_votes WHERE user_id = ? ORDER BY rank ASC').bind(userId).all<VoteRow>();
	return result.results;
}

export interface VoteWithGame extends VoteRow {
	name: string;
	image_url: string | null;
}

export async function getUserVotesWithGames(db: D1Database, userId: string): Promise<VoteWithGame[]> {
	const result = await db
		.prepare(
			`SELECT gv.*, g.name, g.image_url
			FROM game_votes gv
			JOIN games g ON g.id = gv.game_id
			WHERE gv.user_id = ? AND g.is_archived = 0
			ORDER BY gv.rank ASC`,
		)
		.bind(userId)
		.all<VoteWithGame>();
	return result.results;
}

export async function bulkUpdateVoteRanks(
	db: D1Database,
	userId: string,
	rankings: Array<{ game_id: string; rank: number }>,
): Promise<void> {
	for (const { game_id, rank } of rankings) {
		await db
			.prepare('UPDATE game_votes SET rank = ? WHERE game_id = ? AND user_id = ?')
			.bind(rank, game_id, userId)
			.run();
	}
}

/**
 * Borda count ranking: for each user's ranked list of N games,
 * rank 1 gets N points, rank 2 gets N-1, etc.
 * Only approved votes count toward the score.
 */
export async function getGameRanking(db: D1Database): Promise<RankingRow[]> {
	const result = await db
		.prepare(
			`SELECT
				g.id as game_id,
				g.name,
				g.steam_app_id,
				g.image_url,
				g.proposed_by,
				COALESCE(SUM(
					CASE WHEN gv.is_approved = 1 THEN
						(SELECT COUNT(*) FROM game_votes gv2 WHERE gv2.user_id = gv.user_id) - gv.rank + 1
					ELSE 0 END
				), 0) as total_score,
				COUNT(gv.id) as vote_count,
				COALESCE(lk.like_count, 0) as like_count
			FROM games g
			LEFT JOIN game_votes gv ON g.id = gv.game_id
			LEFT JOIN (SELECT game_id, COUNT(*) as like_count FROM game_reactions WHERE type = 'like' GROUP BY game_id) lk ON g.id = lk.game_id
			WHERE g.is_archived = 0
			GROUP BY g.id
			ORDER BY total_score DESC, vote_count DESC`,
		)
		.all<RankingRow>();

	return result.results;
}
