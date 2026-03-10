import type { D1Database } from '@cloudflare/workers-types';
import type { GameRow } from '../db/queries/games';
import { updateGame } from '../db/queries/games';

const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_CHECKS_PER_REQUEST = 3;

function isStale(game: GameRow): boolean {
	if (!game.steam_app_id) return false;
	if (!game.image_checked_at) return true;
	return Date.now() - new Date(game.image_checked_at).getTime() > STALE_THRESHOLD_MS;
}

export async function refreshStaleImages(db: D1Database, games: GameRow[]): Promise<void> {
	const stale = games.filter(isStale).slice(0, MAX_CHECKS_PER_REQUEST);
	if (stale.length === 0) return;

	await Promise.allSettled(
		stale.map(async (game) => {
			const headerUrl = `https://cdn.akamai.steamstatic.com/steam/apps/${game.steam_app_id}/header.jpg`;
			const timestamp = new Date().toISOString();
			// Mark checked before HEAD to prevent concurrent requests from rechecking the same game
			await updateGame(db, game.id, { image_checked_at: timestamp });
			try {
				const res = await fetch(headerUrl, { method: 'HEAD' });
				if (res.ok) {
					await updateGame(db, game.id, { image_url: headerUrl });
				}
			} catch {
				// Leave image_url unchanged; image_checked_at already updated above
			}
		}),
	);
}
