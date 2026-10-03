import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { createTestDb, TEST_GUILD_ID } from '../setup';
import { createAuthenticatedUser, apiRequest, setSettingRaw } from '../helpers';

const ANON = '__anonymous__';

describe('Anonymous rally actions', () => {
	let db: D1Database;
	let alice: { cookie: string; userId: string };
	let bob: { cookie: string; userId: string };

	// Everything that could identify Alice in a response
	const aliceMarkers = () => [alice.userId, '30000000000000001', 'alice-secret', 'https://cdn.example/alice.png'];

	function expectNoAlice(payload: unknown) {
		const text = JSON.stringify(payload);
		for (const marker of aliceMarkers()) expect(text).not.toContain(marker);
	}

	beforeEach(async () => {
		db = createTestDb();
		alice = await createAuthenticatedUser(db, '30000000000000001', 'alice-secret');
		bob = await createAuthenticatedUser(db, '30000000000000002', 'bob');
		await db.prepare('UPDATE users SET avatar_url = ? WHERE id = ?').bind('https://cdn.example/alice.png', alice.userId).run();
		// These tests repeat actions back to back; rate limits are covered in rally-limits.spec.ts
		await setSettingRaw(db, 'gather_cooldown_seconds', 0);
	});

	async function seedAnonymousCall() {
		const call = await apiRequest(db, alice.cookie, 'POST', '/api/rally/call', { message: 'who plays?', is_anonymous: true });
		expect(call.status).toBe(201);
		const reply = await apiRequest(db, bob.cookie, 'POST', '/api/rally/action', { action_type: 'in' });
		expect(reply.status).toBe(201);
		return { call: call.body.data, replyId: reply.body.data.id as string };
	}

	it('the call response itself does not carry the actor or creator_id', async () => {
		const { call } = await seedAnonymousCall();
		expect(call.rally).not.toHaveProperty('creator_id');
		expect(call.action.actor_id).toBe(ANON);
		expect(call.action.metadata).toEqual({ is_anonymous: true });
		expectNoAlice(call);
	});

	it('GET /api/rally/active hides the actor of an anonymous call', async () => {
		const { call } = await seedAnonymousCall();
		const res = await apiRequest(db, bob.cookie, 'GET', '/api/rally/active');
		expect(res.status).toBe(200);
		expect(res.body.data.rally).not.toHaveProperty('creator_id');
		const anon = res.body.data.actions.find((a: any) => a.id === call.action.id);
		expect(anon).toMatchObject({ actor_id: ANON, actor_username: 'Anonymous', actor_avatar: null, actor_discord_id: null, metadata: { is_anonymous: true } });
		const reply = res.body.data.actions.find((a: any) => a.id !== call.action.id);
		expect(reply.actor_id).toBe(bob.userId);
		expect(reply.actor_username).toBe('bob');
		expectNoAlice(res.body);
	});

	it('GET /api/rally/tree hides the actor, keeps edges and leaves the actor out of participants', async () => {
		const { call, replyId } = await seedAnonymousCall();
		const res = await apiRequest(db, bob.cookie, 'GET', '/api/rally/tree');
		expect(res.status).toBe(200);
		const { nodes, edges, rallies, participants } = res.body.data;
		expect(nodes.find((n: any) => n.id === call.action.id).actor_id).toBe(ANON);
		expect(edges).toContainEqual({ source: call.action.id, target: replyId, type: 'response' });
		for (const r of rallies) expect(r).not.toHaveProperty('creator_id');
		expect(Object.keys(participants)).toEqual([bob.userId]);
		expectNoAlice(res.body);
	});

	it('bot payloads (aggregated poll and legacy pending) hide the actor', async () => {
		const { call } = await seedAnonymousCall();
		const env = { BOT_API_KEY: 'testkey', [`DB_${TEST_GUILD_ID}`]: db };
		const pollRes = await app.request('/api/bot/poll', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'X-Bot-Token': 'testkey' },
			body: JSON.stringify({ guild_ids: [TEST_GUILD_ID] }),
		}, env as any);
		const poll = (await pollRes.json()) as any;
		const actions = poll.data.guilds[TEST_GUILD_ID].rally_actions;
		const anon = actions.find((a: any) => a.id === call.action.id);
		expect(anon).toMatchObject({ actor_id: ANON, actor_username: 'Anonymous', actor_discord_id: null, actor_avatar: null });
		expectNoAlice(poll);

		const legacyRes = await app.request('/api/rally/pending', { headers: { 'X-Bot-Token': 'testkey', 'X-Guild-Id': TEST_GUILD_ID } }, env as any);
		expectNoAlice(await legacyRes.json());
	});

	it('a later non-anonymous action by the same user is unaffected', async () => {
		await seedAnonymousCall();
		const own = await apiRequest(db, alice.cookie, 'POST', '/api/rally/action', { action_type: 'out', message: 'nvm' });
		expect(own.status).toBe(201);
		expect(own.body.data.actor_id).toBe(alice.userId);

		const res = await apiRequest(db, bob.cookie, 'GET', '/api/rally/active');
		const out = res.body.data.actions.find((a: any) => a.id === own.body.data.id);
		expect(out).toMatchObject({ actor_id: alice.userId, actor_username: 'alice-secret', actor_discord_id: '30000000000000001' });

		const tree = await apiRequest(db, bob.cookie, 'GET', '/api/rally/tree');
		expect(tree.body.data.participants[alice.userId]).toEqual({ username: 'alice-secret', avatar: 'https://cdn.example/alice.png' });
	});

	it('an anonymous ping still links to the target response, an anonymous response gets no ping edge', async () => {
		await apiRequest(db, bob.cookie, 'POST', '/api/rally/call', {});
		const ping = await apiRequest(db, alice.cookie, 'POST', '/api/rally/action', { action_type: 'ping', target_user_ids: [bob.userId], is_anonymous: true });
		expect(ping.status).toBe(201);
		const reply = await apiRequest(db, bob.cookie, 'POST', '/api/rally/action', { action_type: 'in' });
		const tree = await apiRequest(db, bob.cookie, 'GET', '/api/rally/tree');
		expect(tree.body.data.edges).toContainEqual({ source: ping.body.data.id, target: reply.body.data.id, type: 'ping' });
		expectNoAlice(tree.body);

		// Bob answers a ping from Alice anonymously: an edge to it would name Bob.
		await setSettingRaw(db, 'rally_anonymous_enabled', { call: true, ping: true, out: true });
		const ping2 = await apiRequest(db, alice.cookie, 'POST', '/api/rally/action', { action_type: 'ping', target_user_ids: [bob.userId] });
		const anonOut = await apiRequest(db, bob.cookie, 'POST', '/api/rally/action', { action_type: 'out', is_anonymous: true });
		expect(anonOut.status).toBe(201);
		const tree2 = await apiRequest(db, bob.cookie, 'GET', '/api/rally/tree');
		expect(tree2.body.data.edges.some((e: any) => e.source === ping2.body.data.id && e.target === anonOut.body.data.id)).toBe(false);
	});

	describe('server-side enforcement of rally_anonymous_enabled', () => {
		it('rejects is_anonymous on an action type that is not enabled (default: only call and ping)', async () => {
			const res = await apiRequest(db, alice.cookie, 'POST', '/api/rally/action', { action_type: 'in', is_anonymous: true });
			expect(res.status).toBe(400);
			expect(res.body.error.code).toBe('BAD_REQUEST');
			const count = await db.prepare('SELECT COUNT(*) AS n FROM rally_actions').first<{ n: number }>();
			expect(count!.n).toBe(0);
		});

		it('rejects an anonymous call when the admin disabled it', async () => {
			await setSettingRaw(db, 'rally_anonymous_enabled', { call: false, ping: true });
			const res = await apiRequest(db, alice.cookie, 'POST', '/api/rally/call', { is_anonymous: true });
			expect(res.status).toBe(400);
			expect(res.body.error.code).toBe('BAD_REQUEST');
			const ok = await apiRequest(db, alice.cookie, 'POST', '/api/rally/call', { is_anonymous: false });
			expect(ok.status).toBe(201);
		});

		it('rejects a non-boolean is_anonymous', async () => {
			const res = await apiRequest(db, alice.cookie, 'POST', '/api/rally/action', { action_type: 'ping', target_user_ids: [bob.userId], is_anonymous: 'yes' });
			expect(res.status).toBe(400);
		});
	});
});
