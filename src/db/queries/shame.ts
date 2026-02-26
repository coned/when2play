import type { D1Database } from '@cloudflare/workers-types';
import { uuid, now } from '../helpers';

export interface ShameVoteRow {
	id: string;
	voter_id: string;
	target_id: string;
	reason: string | null;
	created_at: string;
}

export interface ShameLeaderboardRow {
	user_id: string;
	discord_username: string;
	avatar_url: string | null;
	shame_count: number;
	recent_reasons: string[];
}

export async function createShameVote(db: D1Database, voterId: string, targetId: string, reason?: string): Promise<ShameVoteRow> {
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
		.prepare('INSERT INTO shame_votes (id, voter_id, target_id, reason, created_at) VALUES (?, ?, ?, ?, ?)')
		.bind(id, voterId, targetId, reason ?? null, timestamp)
		.run();

	return { id, voter_id: voterId, target_id: targetId, reason: reason ?? null, created_at: timestamp };
}

export async function getShameLeaderboard(db: D1Database): Promise<ShameLeaderboardRow[]> {
	const result = await db
		.prepare(
			`SELECT
				u.id as user_id,
				u.discord_username,
				u.avatar_url,
				COUNT(sv.id) as shame_count
			FROM users u
			LEFT JOIN shame_votes sv ON u.id = sv.target_id
			GROUP BY u.id
			HAVING shame_count > 0
			ORDER BY shame_count DESC`,
		)
		.all<Omit<ShameLeaderboardRow, 'recent_reasons'>>();

	// Fetch recent reasons for each user
	const entries: ShameLeaderboardRow[] = [];
	for (const row of result.results) {
		const reasons = await db
			.prepare(
				`SELECT reason FROM shame_votes
				WHERE target_id = ? AND reason IS NOT NULL AND reason != ''
				ORDER BY created_at DESC LIMIT 3`,
			)
			.bind(row.user_id)
			.all<{ reason: string }>();

		entries.push({
			...row,
			recent_reasons: reasons.results.map((r) => r.reason),
		});
	}

	return entries;
}
