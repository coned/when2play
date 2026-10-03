import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { createTestDb, TEST_GUILD_ID } from '../setup';
import { createAuthenticatedUser, createAuthenticatedAdmin, apiRequest, setSettingRaw } from '../helpers';
import { PENDING_MAX_AGE_MS } from '../../src/lib/pending';

const KEY = 'testkey';

describe('Bot heartbeat and delivery status', () => {
	let db: D1Database;
	let env: Record<string, unknown>;
	let alice: { cookie: string; userId: string };

	beforeEach(async () => {
		db = createTestDb();
		env = { BOT_API_KEY: KEY, [`DB_${TEST_GUILD_ID}`]: db };
		alice = await createAuthenticatedUser(db, '70000000000000001', 'alice');
		await setSettingRaw(db, 'gather_cooldown_seconds', 0);
	});

	async function poll(acks?: Record<string, string[]>) {
		const res = await app.request('/api/bot/poll', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'X-Bot-Token': KEY },
			body: JSON.stringify({ guild_ids: [TEST_GUILD_ID], ...(acks ? { acks: { [TEST_GUILD_ID]: acks } } : {}) }),
		}, env as any);
		expect(res.status).toBe(200);
		return (await res.json()) as any;
	}

	async function heartbeat(): Promise<string | null> {
		const row = await db.prepare("SELECT value FROM settings WHERE key = 'bot_last_poll_at'").first<{ value: string }>();
		return row?.value ?? null;
	}

	const agoIso = (ms: number) => new Date(Date.now() - ms).toISOString();
	const active = async () => (await apiRequest(db, alice.cookie, 'GET', '/api/rally/active')).body.data;

	it('the first poll writes bot_last_poll_at, even for an idle guild', async () => {
		expect(await heartbeat()).toBeNull();
		const before = Date.now();
		const res = await poll();
		expect(res.data.guilds).toEqual({});
		const stored = await heartbeat();
		expect(stored).not.toBeNull();
		expect(Date.parse(stored!)).toBeGreaterThanOrEqual(before - 1000);
	});

	it('rewrites the heartbeat at most once per 60 seconds', async () => {
		const thirtySecondsAgo = agoIso(30_000);
		await setSettingRaw(db, 'bot_last_poll_at', thirtySecondsAgo);
		await poll();
		expect(await heartbeat()).toBe(thirtySecondsAgo);

		const sixtyOneSecondsAgo = agoIso(61_000);
		await setSettingRaw(db, 'bot_last_poll_at', sixtyOneSecondsAgo);
		await poll();
		const stored = await heartbeat();
		expect(stored).not.toBe(sixtyOneSecondsAgo);
		expect(Date.now() - Date.parse(stored!)).toBeLessThan(5_000);
	});

	it('a guild that only receives acks gets no heartbeat', async () => {
		const res = await app.request('/api/bot/poll', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'X-Bot-Token': KEY },
			body: JSON.stringify({ guild_ids: [], acks: { [TEST_GUILD_ID]: { rally_actions: ['x'] } } }),
		}, env as any);
		expect(res.status).toBe(200);
		expect(await heartbeat()).toBeNull();
	});

	it('GET /api/rally/active reports the bot online after a poll and offline 3 minutes later', async () => {
		expect((await active()).bot).toEqual({ online: false, last_seen_at: null });

		await poll();
		const stored = await heartbeat();
		expect((await active()).bot).toEqual({ online: true, last_seen_at: stored });

		const almostThree = agoIso(2 * 60_000 + 50_000);
		await setSettingRaw(db, 'bot_last_poll_at', almostThree);
		expect((await active()).bot).toEqual({ online: true, last_seen_at: almostThree });

		const threeMinutes = agoIso(3 * 60_000 + 1_000);
		await setSettingRaw(db, 'bot_last_poll_at', threeMinutes);
		expect((await active()).bot).toEqual({ online: false, last_seen_at: threeMinutes });
	});

	it('reports delivery_status pending, delivered and expired; expired rows get delivered = 2', async () => {
		const call = await apiRequest(db, alice.cookie, 'POST', '/api/rally/call', {});
		const brb = await apiRequest(db, alice.cookie, 'POST', '/api/rally/action', { action_type: 'brb' });
		const stale = await apiRequest(db, alice.cookie, 'POST', '/api/rally/action', { action_type: 'in' });
		await db.prepare('UPDATE rally_actions SET created_at = ? WHERE id = ?').bind(agoIso(PENDING_MAX_AGE_MS + 60_000), stale.body.data.id).run();

		const byId = async () => Object.fromEntries((await active()).actions.map((a: any) => [a.id, a]));

		// Before any poll: the old row already counts as expired
		let actions = await byId();
		expect(actions[call.body.data.action.id]).toMatchObject({ delivery_status: 'pending', delivered: false });
		expect(actions[stale.body.data.id]).toMatchObject({ delivery_status: 'expired', delivered: false });

		await poll();
		await poll({ rally_actions: [call.body.data.action.id] });

		const flag = async (id: string) => (await db.prepare('SELECT delivered FROM rally_actions WHERE id = ?').bind(id).first<{ delivered: number }>())!.delivered;
		expect(await flag(stale.body.data.id)).toBe(2);
		expect(await flag(call.body.data.action.id)).toBe(1);
		expect(await flag(brb.body.data.id)).toBe(0);

		actions = await byId();
		expect(actions[call.body.data.action.id]).toMatchObject({ delivery_status: 'delivered', delivered: true });
		expect(actions[brb.body.data.id]).toMatchObject({ delivery_status: 'pending', delivered: false });
		expect(actions[stale.body.data.id]).toMatchObject({ delivery_status: 'expired', delivered: false });
	});

	it('game and tree share responses carry bot_online', async () => {
		const game = await apiRequest(db, alice.cookie, 'POST', '/api/games', { name: 'G' });
		const offline = await apiRequest(db, alice.cookie, 'POST', `/api/games/${game.body.data.id}/share`);
		expect(offline.status).toBe(201);
		expect(offline.body.data.bot_online).toBe(false);
		const treeOffline = await apiRequest(db, alice.cookie, 'POST', '/api/rally/tree/share', { image_data: 'AAAA' });
		expect(treeOffline.body.data.bot_online).toBe(false);

		await poll();
		const online = await apiRequest(db, alice.cookie, 'POST', `/api/games/${game.body.data.id}/share`);
		expect(online.body.data.bot_online).toBe(true);
		const treeOnline = await apiRequest(db, alice.cookie, 'POST', '/api/rally/tree/share', { image_data: 'AAAA' });
		expect(treeOnline.body.data.bot_online).toBe(true);
	});

	it('bot_last_poll_at is not an admin setting', async () => {
		await poll();
		const stored = await heartbeat();
		const admin = await createAuthenticatedAdmin(db, 'admin', 'Admin');

		const list = await apiRequest(db, admin.cookie, 'GET', '/api/settings');
		expect(list.body.data).not.toHaveProperty('bot_last_poll_at');
		expect(list.body.data).toHaveProperty('gather_cooldown_seconds');

		const patch = await apiRequest(db, admin.cookie, 'PATCH', '/api/settings', { bot_last_poll_at: '2000-01-01T00:00:00.000Z', gather_hourly_limit: 5 });
		expect(patch.status).toBe(200);
		expect(patch.body.data).not.toHaveProperty('bot_last_poll_at');
		expect(patch.body.data.gather_hourly_limit).toBe(5);
		expect(await heartbeat()).toBe(stored);
	});
});
