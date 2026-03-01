import type { D1Database } from '@cloudflare/workers-types';
import { uuid, now } from '../helpers';

export interface ActivityRow {
	id: string;
	game_id: string;
	user_id: string;
	action: string;
	detail: string | null;
	created_at: string;
}

export interface ActivityWithNames extends ActivityRow {
	game_name: string;
	user_display_name: string | null;
	discord_username: string;
}

export async function logActivity(
	db: D1Database,
	gameId: string,
	userId: string,
	action: string,
	detail?: string,
): Promise<ActivityRow> {
	const id = uuid();
	const timestamp = now();

	await db
		.prepare('INSERT INTO game_activity (id, game_id, user_id, action, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)')
		.bind(id, gameId, userId, action, detail ?? null, timestamp)
		.run();

	return { id, game_id: gameId, user_id: userId, action, detail: detail ?? null, created_at: timestamp };
}

export async function getActivity(db: D1Database, limit: number = 20, before?: string): Promise<ActivityWithNames[]> {
	let query = `
		SELECT ga.*, g.name as game_name, u.display_name as user_display_name, u.discord_username
		FROM game_activity ga
		JOIN games g ON g.id = ga.game_id
		JOIN users u ON u.id = ga.user_id
	`;

	const bindings: unknown[] = [];
	if (before) {
		query += ' WHERE ga.created_at < ?';
		bindings.push(before);
	}

	query += ' ORDER BY ga.created_at DESC LIMIT ?';
	bindings.push(limit);

	const result = await db.prepare(query).bind(...bindings).all<ActivityWithNames>();
	return result.results;
}
