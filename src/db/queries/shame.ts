import type { D1Database } from '@cloudflare/workers-types';
import { uuid, now } from '../helpers';

export interface ShameVoteRow {
	id: string;
	voter_id: string;
	target_id: string;
	reason: string | null;
	is_anonymous: number;
	created_at: string;
}

export interface ShameReasonRow {
	reason: string;
	voter_id: string | null;
	voter_name: string | null;
	voter_avatar: string | null;
}

export interface ShameLeaderboardRow {
	user_id: string;
	discord_username: string;
	avatar_url: string | null;
	shame_count_today: number;
	shame_count_week: number;
	recent_reasons: ShameReasonRow[];
}

export async function createShameVote(db: D1Database, voterId: string, targetId: string, reason?: string, isAnonymous = false): Promise<ShameVoteRow> {
	const id = uuid();
	const timestamp = now();
	const today = timestamp.split('T')[0];

	// Check if already shamed today
	const existing = await db
		.prepare("SELECT * FROM shame_votes WHERE voter_id = ? AND target_id = ? AND created_at LIKE ? || '%'")
		.bind(voterId, targetId, today)
		.first();

	if (existing) {
		throw new Error('Already shamed this user today');
	}

	await db
		.prepare('INSERT INTO shame_votes (id, voter_id, target_id, reason, is_anonymous, created_at) VALUES (?, ?, ?, ?, ?, ?)')
		.bind(id, voterId, targetId, reason ?? null, isAnonymous ? 1 : 0, timestamp)
		.run();

	return { id, voter_id: voterId, target_id: targetId, reason: reason ?? null, is_anonymous: isAnonymous ? 1 : 0, created_at: timestamp };
}

export async function deleteShameVote(db: D1Database, voterId: string, targetId: string): Promise<void> {
	const today = now().split('T')[0];
	await db
		.prepare("DELETE FROM shame_votes WHERE voter_id = ? AND target_id = ? AND created_at LIKE ? || '%'")
		.bind(voterId, targetId, today)
		.run();
}

export async function getMyShameVotesToday(db: D1Database, voterId: string): Promise<string[]> {
	const today = now().split('T')[0];
	const result = await db
		.prepare("SELECT target_id FROM shame_votes WHERE voter_id = ? AND created_at LIKE ? || '%'")
		.bind(voterId, today)
		.all<{ target_id: string }>();
	return result.results.map((r) => r.target_id);
}

/** Delete shame votes older than 7 days. */
async function cleanupOldShameVotes(db: D1Database): Promise<void> {
	const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
	await db.prepare('DELETE FROM shame_votes WHERE created_at < ?').bind(cutoff).run();
}

export async function getShameLeaderboard(db: D1Database): Promise<ShameLeaderboardRow[]> {
	// Piggyback cleanup on reads
	await cleanupOldShameVotes(db);

	const today = now().split('T')[0];
	const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

	const result = await db
		.prepare(
			`SELECT
				u.id as user_id,
				u.discord_username,
				u.avatar_url,
				SUM(CASE WHEN sv.created_at >= ? THEN 1 ELSE 0 END) as shame_count_today,
				COUNT(sv.id) as shame_count_week
			FROM users u
			LEFT JOIN shame_votes sv ON u.id = sv.target_id
				AND sv.created_at >= ?
			GROUP BY u.id
			HAVING shame_count_week > 0
			ORDER BY shame_count_week DESC`,
		)
		.bind(today, sevenDaysAgo)
		.all<Omit<ShameLeaderboardRow, 'recent_reasons'>>();

	// Fetch recent reasons for each user with voter info
	const entries: ShameLeaderboardRow[] = [];
	for (const row of result.results) {
		const reasons = await db
			.prepare(
				`SELECT sv.reason, sv.is_anonymous,
					sv.voter_id,
					v.display_name as voter_display_name,
					v.discord_username as voter_discord_username,
					v.avatar_url as voter_avatar
				FROM shame_votes sv
				LEFT JOIN users v ON sv.voter_id = v.id
				WHERE sv.target_id = ? AND sv.reason IS NOT NULL AND sv.reason != ''
				ORDER BY sv.created_at DESC LIMIT 3`,
			)
			.bind(row.user_id)
			.all<{ reason: string; is_anonymous: number; voter_id: string; voter_display_name: string | null; voter_discord_username: string; voter_avatar: string | null }>();

		entries.push({
			...row,
			recent_reasons: reasons.results.map((r) => ({
				reason: r.reason,
				voter_id: r.is_anonymous ? null : r.voter_id,
				voter_name: r.is_anonymous ? null : (r.voter_display_name ?? r.voter_discord_username),
				voter_avatar: r.is_anonymous ? null : r.voter_avatar,
			})),
		});
	}

	return entries;
}
