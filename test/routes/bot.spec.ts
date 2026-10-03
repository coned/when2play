import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { createTestDb, guildUrl, guildCookie, testEnv, TEST_GUILD_ID } from '../setup';
import { createAuthenticatedUser } from '../helpers';
import { PENDING_MAX_AGE_MS } from '../../src/lib/pending';

const GUILD_2 = '99999999999999999';
const UNKNOWN_GUILD = '55555555555555555';

function staleIso(): string {
	return new Date(Date.now() - PENDING_MAX_AGE_MS - 60_000).toISOString();
}

async function post(db: D1Database, cookie: string, path: string, body: unknown) {
	const res = await app.request(
		guildUrl(path),
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Cookie: guildCookie(cookie) },
			body: JSON.stringify(body),
		},
		testEnv(db),
	);
	expect(res.status).toBe(201);
	return ((await res.json()) as any).data;
}

/** Seed one item of each delivery kind into a guild DB. Uses the API so rows match production. */
async function seedGuild(db: D1Database, prefix: string) {
	const alice = await createAuthenticatedUser(db, `${prefix}1`, `${prefix}-alice`);
	const bob = await createAuthenticatedUser(db, `${prefix}2`, `${prefix}-bob`);
	const call = await post(db, alice.cookie, '/api/rally/call', { message: 'game?' });
	const ping = await post(db, alice.cookie, '/api/rally/action', { action_type: 'ping', target_user_ids: [bob.userId], message: 'hey' });
	const tree = await post(db, alice.cookie, '/api/rally/tree/share', { image_data: 'data:image/png;base64,AAAA' });
	const game = await post(db, alice.cookie, '/api/games', { name: `${prefix} Game` });
	const gameShare = await post(db, alice.cookie, `/api/games/${game.id}/share`, {});
	return { alice, bob, callId: call.action.id as string, pingId: ping.id as string, treeId: tree.id as string, gameShareId: gameShare.id as string };
}

async function poll(env: Record<string, unknown>, body: unknown, headers: Record<string, string> = { 'X-Bot-Token': 'testkey' }) {
	const res = await app.request(
		'/api/bot/poll',
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json', ...headers },
			body: typeof body === 'string' ? body : JSON.stringify(body),
		},
		env as any,
	);
	return { status: res.status, body: (await res.json()) as any };
}

async function legacyGet(env: Record<string, unknown>, path: string, guildId: string = TEST_GUILD_ID) {
	const res = await app.request(path, { headers: { 'X-Bot-Token': 'testkey', 'X-Guild-Id': guildId } }, env as any);
	expect(res.status).toBe(200);
	return ((await res.json()) as any).data as any[];
}

async function deliveredFlag(db: D1Database, table: string, id: string): Promise<number> {
	const row = await db.prepare(`SELECT delivered FROM ${table} WHERE id = ?`).bind(id).first<{ delivered: number }>();
	return row!.delivered;
}

describe('POST /api/bot/poll', () => {
	let db1: D1Database;
	let db2: D1Database;
	let env: Record<string, unknown>;

	beforeEach(() => {
		db1 = createTestDb();
		db2 = createTestDb();
		env = { BOT_API_KEY: 'testkey', [`DB_${TEST_GUILD_ID}`]: db1, [`DB_${GUILD_2}`]: db2 };
	});

	it('rejects a missing X-Bot-Token when BOT_API_KEY is set', async () => {
		const res = await poll(env, { guild_ids: [TEST_GUILD_ID] }, {});
		expect(res.status).toBe(403);
		expect(res.body.ok).toBe(false);
		expect(res.body.error.code).toBe('FORBIDDEN');
	});

	it('rejects a wrong X-Bot-Token', async () => {
		const res = await poll(env, { guild_ids: [TEST_GUILD_ID] }, { 'X-Bot-Token': 'wrong' });
		expect(res.status).toBe(403);
		expect(res.body.error.code).toBe('FORBIDDEN');
	});

	it('works without X-Guild-Id or ?guild= and returns empty guilds when idle', async () => {
		const res = await poll(env, { guild_ids: [TEST_GUILD_ID, GUILD_2] });
		expect(res.status).toBe(200);
		expect(res.body).toEqual({ ok: true, data: { guilds: {}, unknown_guilds: [], errors: {} } });
	});

	it('reports guilds without a DB binding in unknown_guilds', async () => {
		const res = await poll(env, { guild_ids: [TEST_GUILD_ID, UNKNOWN_GUILD] });
		expect(res.status).toBe(200);
		expect(res.body.data.unknown_guilds).toEqual([UNKNOWN_GUILD]);
		expect(res.body.data.guilds).toEqual({});
		expect(res.body.data.errors).toEqual({});
	});

	it('aggregates two guild DBs and keeps them separate', async () => {
		const g1 = await seedGuild(db1, '1000000000000000');
		const g2 = await seedGuild(db2, '2000000000000000');

		const res = await poll(env, { guild_ids: [TEST_GUILD_ID, GUILD_2] });
		expect(res.status).toBe(200);
		const guilds = res.body.data.guilds;
		expect(Object.keys(guilds).sort()).toEqual([GUILD_2, TEST_GUILD_ID].sort());

		expect(guilds[TEST_GUILD_ID].rally_actions.map((a: any) => a.id).sort()).toEqual([g1.callId, g1.pingId].sort());
		expect(guilds[TEST_GUILD_ID].tree_shares.map((s: any) => s.id)).toEqual([g1.treeId]);
		expect(guilds[TEST_GUILD_ID].game_shares.map((s: any) => s.id)).toEqual([g1.gameShareId]);
		expect(guilds[GUILD_2].rally_actions.map((a: any) => a.id).sort()).toEqual([g2.callId, g2.pingId].sort());
		expect(guilds[GUILD_2].tree_shares.map((s: any) => s.id)).toEqual([g2.treeId]);
		expect(guilds[GUILD_2].game_shares.map((s: any) => s.id)).toEqual([g2.gameShareId]);
		expect(guilds[GUILD_2].game_shares[0].game_name).toBe('2000000000000000 Game');
	});

	it('returns fresh items with the same fields as the legacy pending endpoints', async () => {
		const g1 = await seedGuild(db1, '1000000000000000');

		const res = await poll(env, { guild_ids: [TEST_GUILD_ID] });
		const data = res.body.data.guilds[TEST_GUILD_ID];

		const legacyActions = await legacyGet(env, '/api/rally/pending');
		const legacyTrees = await legacyGet(env, '/api/rally/tree/share/pending');
		const legacyGames = await legacyGet(env, '/api/games/share/pending');
		expect(data.rally_actions).toEqual(legacyActions);
		expect(data.tree_shares).toEqual(legacyTrees);
		expect(data.game_shares).toEqual(legacyGames);

		const ping = data.rally_actions.find((a: any) => a.id === g1.pingId);
		expect(ping.delivered).toBe(false);
		expect(ping.target_user_ids).toEqual([g1.bob.userId]);
		expect(ping.target_discord_ids).toEqual(['10000000000000002']);
		expect(ping.actor_username).toBe('1000000000000000-alice');
		expect(ping.actor_discord_id).toBe('10000000000000001');
		expect(ping).toHaveProperty('metadata', null);
		expect(data.tree_shares[0].image_data).toBe('data:image/png;base64,AAAA');
		const gs = data.game_shares[0];
		for (const key of ['game_name', 'game_note', 'game_image_url', 'game_steam_app_id', 'like_count', 'dislike_count', 'requester_name']) {
			expect(gs).toHaveProperty(key);
		}
		expect(gs.delivered).toBe(false);
		expect(gs.requester_name).toBe('1000000000000000-alice');
	});

	it('marks acked ids delivered and does not return them again', async () => {
		const g1 = await seedGuild(db1, '1000000000000000');

		const acks = {
			[TEST_GUILD_ID]: { rally_actions: [g1.callId], tree_shares: [g1.treeId], game_shares: [g1.gameShareId] },
		};
		const first = await poll(env, { guild_ids: [TEST_GUILD_ID], acks });
		expect(first.status).toBe(200);
		const data = first.body.data.guilds[TEST_GUILD_ID];
		expect(data.rally_actions.map((a: any) => a.id)).toEqual([g1.pingId]);
		expect(data.tree_shares).toEqual([]);
		expect(data.game_shares).toEqual([]);

		expect(await deliveredFlag(db1, 'rally_actions', g1.callId)).toBe(1);
		expect(await deliveredFlag(db1, 'rally_tree_shares', g1.treeId)).toBe(1);
		expect(await deliveredFlag(db1, 'game_shares', g1.gameShareId)).toBe(1);

		// Ack the last one; the next poll is idle and re-sending old acks is harmless.
		const second = await poll(env, { guild_ids: [TEST_GUILD_ID], acks: { [TEST_GUILD_ID]: { rally_actions: [g1.pingId, g1.callId] } } });
		expect(second.body.data.guilds).toEqual({});
		const third = await poll(env, { guild_ids: [TEST_GUILD_ID] });
		expect(third.body.data.guilds).toEqual({});
	});

	it('applies acks for a bound guild that is not in guild_ids', async () => {
		const g2 = await seedGuild(db2, '2000000000000000');
		const res = await poll(env, { guild_ids: [TEST_GUILD_ID], acks: { [GUILD_2]: { tree_shares: [g2.treeId] } } });
		expect(res.status).toBe(200);
		expect(res.body.data.guilds).toEqual({});
		expect(await deliveredFlag(db2, 'rally_tree_shares', g2.treeId)).toBe(1);
		expect(await deliveredFlag(db2, 'game_shares', g2.gameShareId)).toBe(0);
	});

	it('handles acks larger than one chunk', async () => {
		const g1 = await seedGuild(db1, '1000000000000000');
		const ids = Array.from({ length: 199 }, (_, i) => `missing-${i}`).concat([g1.callId]);
		const res = await poll(env, { guild_ids: [TEST_GUILD_ID], acks: { [TEST_GUILD_ID]: { rally_actions: ids } } });
		expect(res.status).toBe(200);
		expect(await deliveredFlag(db1, 'rally_actions', g1.callId)).toBe(1);
	});

	it('never returns rows older than 30 minutes and marks them delivered', async () => {
		const g1 = await seedGuild(db1, '1000000000000000');
		const old = staleIso();
		await db1.prepare('UPDATE rally_actions SET created_at = ? WHERE id = ?').bind(old, g1.callId).run();
		await db1.prepare('UPDATE rally_tree_shares SET created_at = ?').bind(old).run();
		await db1.prepare('UPDATE game_shares SET created_at = ?').bind(old).run();

		const res = await poll(env, { guild_ids: [TEST_GUILD_ID] });
		const data = res.body.data.guilds[TEST_GUILD_ID];
		expect(data.rally_actions.map((a: any) => a.id)).toEqual([g1.pingId]);
		expect(data.tree_shares).toEqual([]);
		expect(data.game_shares).toEqual([]);

		expect(await deliveredFlag(db1, 'rally_actions', g1.callId)).toBe(1);
		expect(await deliveredFlag(db1, 'rally_actions', g1.pingId)).toBe(0);
		expect(await deliveredFlag(db1, 'rally_tree_shares', g1.treeId)).toBe(1);
		expect(await deliveredFlag(db1, 'game_shares', g1.gameShareId)).toBe(1);
	});

	it('omits a guild whose pending rows are all stale', async () => {
		await seedGuild(db1, '1000000000000000');
		const old = staleIso();
		for (const table of ['rally_actions', 'rally_tree_shares', 'game_shares']) {
			await db1.prepare(`UPDATE ${table} SET created_at = ?`).bind(old).run();
		}
		const res = await poll(env, { guild_ids: [TEST_GUILD_ID] });
		expect(res.body.data.guilds).toEqual({});
		const row = await db1
			.prepare('SELECT (SELECT COUNT(*) FROM rally_actions WHERE delivered = 0) + (SELECT COUNT(*) FROM rally_tree_shares WHERE delivered = 0) + (SELECT COUNT(*) FROM game_shares WHERE delivered = 0) AS n')
			.first<{ n: number }>();
		expect(row!.n).toBe(0);
	});

	it('reports a failing guild under errors without failing the others', async () => {
		const g2 = await seedGuild(db2, '2000000000000000');
		const broken = createTestDb();
		await broken.exec('DROP TABLE game_shares');
		const res = await poll(
			{ ...env, [`DB_${TEST_GUILD_ID}`]: broken },
			{ guild_ids: [TEST_GUILD_ID, GUILD_2] },
		);
		expect(res.status).toBe(200);
		expect(Object.keys(res.body.data.errors)).toEqual([TEST_GUILD_ID]);
		expect(typeof res.body.data.errors[TEST_GUILD_ID]).toBe('string');
		expect(res.body.data.guilds[TEST_GUILD_ID]).toBeUndefined();
		expect(res.body.data.guilds[GUILD_2].tree_shares.map((s: any) => s.id)).toEqual([g2.treeId]);
	});

	describe('malformed bodies return 400', () => {
		const cases: Array<[string, unknown]> = [
			['invalid JSON', '{not json'],
			['non-object body', [TEST_GUILD_ID]],
			['missing guild_ids', {}],
			['guild_ids not an array', { guild_ids: TEST_GUILD_ID }],
			['non-numeric guild id', { guild_ids: ['abc'] }],
			['numeric (not string) guild id', { guild_ids: [12345678901234567] }],
			['too many guilds', { guild_ids: Array.from({ length: 101 }, (_, i) => `10000000000000${String(i).padStart(3, '0')}`) }],
			['acks not an object', { guild_ids: [TEST_GUILD_ID], acks: [] }],
			['acks with invalid guild key', { guild_ids: [TEST_GUILD_ID], acks: { abc: {} } }],
			['acks list not an array', { guild_ids: [TEST_GUILD_ID], acks: { [TEST_GUILD_ID]: { rally_actions: 'x' } } }],
			['acks with unknown kind', { guild_ids: [TEST_GUILD_ID], acks: { [TEST_GUILD_ID]: { gather_pings: [] } } }],
			['acks with non-string id', { guild_ids: [TEST_GUILD_ID], acks: { [TEST_GUILD_ID]: { tree_shares: [1] } } }],
			['acks list over 200 ids', { guild_ids: [TEST_GUILD_ID], acks: { [TEST_GUILD_ID]: { game_shares: Array.from({ length: 201 }, (_, i) => `id-${i}`) } } }],
		];
		for (const [name, body] of cases) {
			it(name, async () => {
				const res = await poll(env, body);
				expect(res.status).toBe(400);
				expect(res.body.ok).toBe(false);
				expect(res.body.error.code).toBe('BAD_REQUEST');
			});
		}
	});

	it('accepts duplicate guild ids that collapse to 100 or fewer', async () => {
		const res = await poll(env, { guild_ids: Array.from({ length: 150 }, () => TEST_GUILD_ID) });
		expect(res.status).toBe(200);
	});
});

describe('Legacy pending endpoints', () => {
	it('skip rows older than 30 minutes', async () => {
		const db = createTestDb();
		const env = { BOT_API_KEY: 'testkey', [`DB_${TEST_GUILD_ID}`]: db };
		const g = await seedGuild(db, '1000000000000000');
		const old = staleIso();
		await db.prepare('UPDATE rally_actions SET created_at = ? WHERE id = ?').bind(old, g.callId).run();
		await db.prepare('UPDATE rally_tree_shares SET created_at = ?').bind(old).run();
		await db.prepare('UPDATE game_shares SET created_at = ?').bind(old).run();

		expect((await legacyGet(env, '/api/rally/pending')).map((a) => a.id)).toEqual([g.pingId]);
		expect(await legacyGet(env, '/api/rally/tree/share/pending')).toEqual([]);
		expect(await legacyGet(env, '/api/games/share/pending')).toEqual([]);

		// Read-only: the legacy endpoints filter but do not mark anything delivered.
		expect(await deliveredFlag(db, 'rally_actions', g.callId)).toBe(0);
	});

	it('legacy delivered PATCH still works', async () => {
		const db = createTestDb();
		const env = { BOT_API_KEY: 'testkey', [`DB_${TEST_GUILD_ID}`]: db };
		const g = await seedGuild(db, '1000000000000000');
		const res = await app.request(`/api/games/share/${g.gameShareId}/delivered`, {
			method: 'PATCH',
			headers: { 'X-Bot-Token': 'testkey', 'X-Guild-Id': TEST_GUILD_ID },
		}, env as any);
		expect(res.status).toBe(200);
		expect(await deliveredFlag(db, 'game_shares', g.gameShareId)).toBe(1);
	});
});
