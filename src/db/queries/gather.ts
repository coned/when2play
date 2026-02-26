import type { D1Database } from '@cloudflare/workers-types';
import { uuid, now } from '../helpers';

export interface GatherPingRow {
	id: string;
	user_id: string;
	message: string | null;
	delivered: number;
	is_anonymous: number;
	target_user_ids: string | null;
	created_at: string;
}

export interface GatherPingWithDiscord extends GatherPingRow {
	sender_discord_id: string;
	sender_username: string;
	target_discord_ids: string[] | null;
}

export interface CreateGatherPingOptions {
	message?: string;
	is_anonymous?: boolean;
	target_user_ids?: string[];
}

export async function createGatherPing(
	db: D1Database,
	userId: string,
	message?: string,
	options?: { is_anonymous?: boolean; target_user_ids?: string[] },
): Promise<GatherPingRow> {
	const id = uuid();
	const timestamp = now();
	const isAnonymous = options?.is_anonymous ? 1 : 0;
	const targetIds = options?.target_user_ids ? JSON.stringify(options.target_user_ids) : null;

	await db
		.prepare(
			'INSERT INTO gather_pings (id, user_id, message, delivered, is_anonymous, target_user_ids, created_at) VALUES (?, ?, ?, 0, ?, ?, ?)',
		)
		.bind(id, userId, message ?? null, isAnonymous, targetIds, timestamp)
		.run();

	return {
		id,
		user_id: userId,
		message: message ?? null,
		delivered: 0,
		is_anonymous: isAnonymous,
		target_user_ids: targetIds,
		created_at: timestamp,
	};
}

export async function getLastGatherPing(db: D1Database, userId: string): Promise<GatherPingRow | null> {
	return db.prepare('SELECT * FROM gather_pings WHERE user_id = ? ORDER BY created_at DESC LIMIT 1').bind(userId).first<GatherPingRow>();
}

export async function getPendingGatherPings(db: D1Database): Promise<GatherPingWithDiscord[]> {
	const result = await db
		.prepare(
			`SELECT gp.*, u.discord_id as sender_discord_id, u.discord_username as sender_username
			FROM gather_pings gp
			JOIN users u ON gp.user_id = u.id
			WHERE gp.delivered = 0
			ORDER BY gp.created_at ASC`,
		)
		.all<GatherPingRow & { sender_discord_id: string; sender_username: string }>();

	const pings: GatherPingWithDiscord[] = [];
	for (const row of result.results) {
		let target_discord_ids: string[] | null = null;
		if (row.target_user_ids) {
			const targetIds: string[] = JSON.parse(row.target_user_ids);
			const resolved: string[] = [];
			for (const id of targetIds) {
				const user = await db
					.prepare('SELECT discord_id FROM users WHERE id = ?')
					.bind(id)
					.first<{ discord_id: string }>();
				if (user) resolved.push(user.discord_id);
			}
			target_discord_ids = resolved;
		}
		pings.push({ ...row, target_discord_ids });
	}
	return pings;
}

export async function markGatherDelivered(db: D1Database, id: string): Promise<boolean> {
	await db.prepare('UPDATE gather_pings SET delivered = 1 WHERE id = ?').bind(id).run();
	return true;
}
