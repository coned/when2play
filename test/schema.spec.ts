import { describe, it, expect } from 'vitest';
import { createTestDb } from './setup';

/**
 * Guards against a migration consolidation silently dropping a table again
 * (game_activity and game_reactions were lost that way once). If you add or
 * remove a table on purpose, update this list.
 */
const EXPECTED_TABLES = [
	'auth_tokens',
	'availability',
	'availability_status',
	'game_activity',
	'game_reactions',
	'game_shares',
	'game_votes',
	'games',
	'gather_pings',
	'rallies',
	'rally_actions',
	'rally_tree_shares',
	'sessions',
	'settings',
	'shame_votes',
	'users',
];

describe('Database schema', () => {
	it('a fresh database built from migrations has exactly the application tables', async () => {
		const db = createTestDb();
		const { results } = await db
			.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
			.all<{ name: string }>();
		expect(results.map((r) => r.name)).toEqual(EXPECTED_TABLES);
	});

	it('has the delivery indexes the bot poll relies on', async () => {
		const db = createTestDb();
		const { results } = await db
			.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'")
			.all<{ name: string }>();
		const names = results.map((r) => r.name);
		for (const idx of ['idx_rally_actions_delivered', 'idx_tree_shares_delivered', 'idx_game_shares_delivered', 'idx_game_activity_created_at', 'idx_game_reactions_user_id']) {
			expect(names).toContain(idx);
		}
	});
});
