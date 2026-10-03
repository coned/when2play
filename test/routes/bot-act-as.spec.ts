import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { createTestDb, guildUrl, guildCookie, testEnv, TEST_GUILD_ID } from '../setup';
import { createAuthenticatedUser } from '../helpers';

const KEY = 'testkey';
const ALICE_DISCORD = '60000000000000001';
const BOB_DISCORD = '60000000000000002';

function botHeaders(extra: Record<string, string> = {}): Record<string, string> {
	return { 'Content-Type': 'application/json', 'X-Bot-Token': KEY, 'X-Guild-Id': TEST_GUILD_ID, ...extra };
}

async function call(env: Record<string, unknown>, method: string, path: string, headers: Record<string, string>, body?: unknown) {
	const res = await app.request(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }, env as any);
	return { status: res.status, body: (await res.json()) as any };
}

async function count(db: D1Database, table: string): Promise<number> {
	const row = await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>();
	return row!.n;
}

describe('POST /api/users/sync', () => {
	let db: D1Database;
	let env: Record<string, unknown>;

	beforeEach(() => {
		db = createTestDb();
		env = testEnv(db, { BOT_API_KEY: KEY });
	});

	it('upserts users, returns rows in request order and creates no token or session', async () => {
		const first = await call(env, 'POST', '/api/users/sync', botHeaders(), {
			users: [
				{ discord_id: BOB_DISCORD, discord_username: 'bob', avatar_url: 'https://cdn.example/bob.png' },
				{ discord_id: ALICE_DISCORD, discord_username: 'alice' },
			],
			guild_name: 'My Server',
		});
		expect(first.status).toBe(200);
		expect(first.body.ok).toBe(true);
		const rows = first.body.data.users;
		expect(rows.map((u: any) => u.discord_id)).toEqual([BOB_DISCORD, ALICE_DISCORD]);
		expect(Object.keys(rows[0]).sort()).toEqual(['avatar_url', 'discord_id', 'discord_username', 'display_name', 'id']);
		expect(rows[0]).toMatchObject({ discord_username: 'bob', display_name: 'bob', avatar_url: 'https://cdn.example/bob.png' });
		expect(rows[1].avatar_url).toBeNull();

		// Second sync updates in place: same ids, new name, avatar kept when null/absent
		const second = await call(env, 'POST', '/api/users/sync', botHeaders(), {
			users: [
				{ discord_id: ALICE_DISCORD, discord_username: 'alice2' },
				{ discord_id: BOB_DISCORD, discord_username: 'bob', avatar_url: null },
			],
		});
		expect(second.status).toBe(200);
		expect(second.body.data.users.map((u: any) => u.id)).toEqual([rows[1].id, rows[0].id]);
		expect(second.body.data.users[0].discord_username).toBe('alice2');
		expect(second.body.data.users[1].avatar_url).toBe('https://cdn.example/bob.png');

		expect(await count(db, 'users')).toBe(2);
		expect(await count(db, 'auth_tokens')).toBe(0);
		expect(await count(db, 'sessions')).toBe(0);
		const guildName = await db.prepare("SELECT value FROM settings WHERE key = 'guild_name'").first<{ value: string }>();
		expect(guildName!.value).toBe('My Server');
	});

	it('rejects more than 10 users, an empty list and invalid fields', async () => {
		const many = Array.from({ length: 11 }, (_, i) => ({ discord_id: `6100000000000000${i}`, discord_username: `u${i}` }));
		for (const body of [
			{ users: many },
			{ users: [] },
			{},
			{ users: [{ discord_id: '', discord_username: 'x' }] },
			{ users: [{ discord_id: '1', discord_username: 'x'.repeat(51) }] },
			{ users: [{ discord_id: '1', discord_username: 'x', avatar_url: 'x'.repeat(501) }] },
			{ users: [{ discord_id: '1', discord_username: 'x' }], guild_name: 'x'.repeat(101) },
		]) {
			const res = await call(env, 'POST', '/api/users/sync', botHeaders(), body);
			expect(res.status, JSON.stringify(body).slice(0, 80)).toBe(400);
			expect(res.body.error.code).toBe('BAD_REQUEST');
		}
		expect(await count(db, 'users')).toBe(0);
	});

	it('requires the bot token', async () => {
		const res = await call(env, 'POST', guildUrl('/api/users/sync'), { 'Content-Type': 'application/json', 'X-Bot-Token': 'wrong' }, {
			users: [{ discord_id: ALICE_DISCORD, discord_username: 'alice' }],
		});
		expect(res.status).toBe(403);
	});
});

describe('Acting as a user with X-Discord-User-Id', () => {
	let db: D1Database;
	let env: Record<string, unknown>;
	let aliceId: string;
	let bob: { cookie: string; userId: string };

	beforeEach(async () => {
		db = createTestDb();
		env = testEnv(db, { BOT_API_KEY: KEY });
		const sync = await call(env, 'POST', '/api/users/sync', botHeaders(), { users: [{ discord_id: ALICE_DISCORD, discord_username: 'alice' }] });
		aliceId = sync.body.data.users[0].id;
		bob = await createAuthenticatedUser(db, BOB_DISCORD, 'bob');
	});

	it('authenticates as the user with that discord_id, never as admin', async () => {
		const res = await call(env, 'POST', '/api/rally/action', botHeaders({ 'X-Discord-User-Id': ALICE_DISCORD }), { action_type: 'in' });
		expect(res.status).toBe(201);
		expect(res.body.data.actor_id).toBe(aliceId);

		const me = await call(env, 'GET', '/api/users/me', botHeaders({ 'X-Discord-User-Id': ALICE_DISCORD }));
		expect(me.status).toBe(200);
		expect(me.body.data.id).toBe(aliceId);
		expect(me.body.data.is_admin).toBe(false);

		const settings = await call(env, 'PATCH', '/api/settings', botHeaders({ 'X-Discord-User-Id': ALICE_DISCORD }), { gather_hourly_limit: 1 });
		expect(settings.status).toBe(403);
		expect(await count(db, 'sessions')).toBe(1); // only Bob's cookie session
	});

	it('answers 401 for an unknown discord id', async () => {
		const res = await call(env, 'POST', '/api/rally/action', botHeaders({ 'X-Discord-User-Id': '69999999999999999' }), { action_type: 'in' });
		expect(res.status).toBe(401);
		expect(res.body.error.code).toBe('UNAUTHORIZED');
		const empty = await call(env, 'GET', '/api/users/me', botHeaders({ 'X-Discord-User-Id': '' }));
		expect(empty.status).toBe(401);
		expect(await count(db, 'rally_actions')).toBe(0);
	});

	it('does not act as the user with a wrong bot token', async () => {
		const headers = { 'Content-Type': 'application/json', 'X-Bot-Token': 'wrong', 'X-Discord-User-Id': ALICE_DISCORD };
		const res = await call(env, 'POST', guildUrl('/api/rally/action'), headers, { action_type: 'in' });
		expect(res.status).toBe(401);
		expect(await count(db, 'rally_actions')).toBe(0);

		// With a cookie the request is the cookie user, not the named Discord user
		const withCookie = await call(env, 'GET', guildUrl('/api/users/me'), { ...headers, Cookie: guildCookie(bob.cookie) });
		expect(withCookie.status).toBe(200);
		expect(withCookie.body.data.id).toBe(bob.userId);
	});

	it('is ignored when BOT_API_KEY is unset', async () => {
		const noKey = testEnv(db);
		const headers = { 'Content-Type': 'application/json', 'X-Bot-Token': KEY, 'X-Discord-User-Id': ALICE_DISCORD };
		const res = await call(noKey, 'POST', guildUrl('/api/rally/action'), headers, { action_type: 'in' });
		expect(res.status).toBe(401);
		expect(await count(db, 'rally_actions')).toBe(0);

		const withCookie = await call(noKey, 'GET', guildUrl('/api/users/me'), { ...headers, Cookie: guildCookie(bob.cookie) });
		expect(withCookie.body.data.id).toBe(bob.userId);
	});

	it('cookie sessions keep working next to the bot path', async () => {
		const res = await call(env, 'GET', guildUrl('/api/users/me'), { Cookie: guildCookie(bob.cookie) });
		expect(res.status).toBe(200);
		expect(res.body.data.id).toBe(bob.userId);
	});
});

describe('Auth token cleanup', () => {
	it('deletes used and expired tokens and expired sessions when a token is created', async () => {
		const db = createTestDb();
		const user = await createAuthenticatedUser(db, '62000000000000001', 'carol');
		const past = new Date(Date.now() - 60_000).toISOString();
		const future = new Date(Date.now() + 3_600_000).toISOString();
		const nowIso = new Date().toISOString();
		const insertToken = (id: string, expires: string, used: number) =>
			db.prepare('INSERT INTO auth_tokens (id, token, user_id, expires_at, used, is_admin, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)').bind(id, `tok-${id}`, user.userId, expires, used, nowIso).run();
		const insertSession = (id: string, expires: string) =>
			db.prepare('INSERT INTO sessions (id, session_id, user_id, expires_at, is_admin, created_at) VALUES (?, ?, ?, ?, 0, ?)').bind(id, `sess-${id}`, user.userId, expires, nowIso).run();
		await insertToken('expired', past, 0);
		await insertToken('used', future, 1);
		await insertToken('live', future, 0);
		await insertSession('old', past);
		await insertSession('current', future);

		for (const path of ['/api/auth/token', '/api/auth/admin-token']) {
			const res = await app.request(guildUrl(path), {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', 'X-Guild-Id': TEST_GUILD_ID },
				body: JSON.stringify({ discord_id: '62000000000000002', discord_username: 'dave' }),
			}, testEnv(db));
			expect(res.status).toBe(201);

			const tokens = await db.prepare('SELECT id, used, expires_at FROM auth_tokens').all<{ id: string; used: number; expires_at: string }>();
			const ids = tokens.results.map((t) => t.id);
			expect(ids).not.toContain('expired');
			expect(ids).not.toContain('used');
			expect(ids).toContain('live');
			for (const t of tokens.results) {
				expect(t.used).toBe(0);
				expect(new Date(t.expires_at).getTime()).toBeGreaterThan(Date.now());
			}
			const sessions = await db.prepare('SELECT id FROM sessions').all<{ id: string }>();
			expect(sessions.results.map((s) => s.id)).not.toContain('old');
			expect(sessions.results.map((s) => s.id)).toContain('current');

			// Re-seed the stale rows for the next endpoint
			await insertToken('expired', past, 0);
			await insertToken('used', future, 1);
			await insertSession('old', past);
		}
	});
});
