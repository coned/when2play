import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../setup';
import { createAuthenticatedUser, apiRequest, setSettingRaw } from '../helpers';

const RATE_MSG = /Try again in \d+s/;

describe('Rate limits on everything that posts to Discord', () => {
	let db: D1Database;
	let alice: { cookie: string; userId: string };
	let bob: { cookie: string; userId: string };

	beforeEach(async () => {
		db = createTestDb();
		alice = await createAuthenticatedUser(db, '40000000000000001', 'alice');
		bob = await createAuthenticatedUser(db, '40000000000000002', 'bob');
	});

	const act = (who: { cookie: string }, body: unknown) => apiRequest(db, who.cookie, 'POST', '/api/rally/action', body);

	async function insertActions(actorId: string, count: number, createdAt: string) {
		for (let i = 0; i < count; i++) {
			await db
				.prepare("INSERT INTO rally_actions (id, actor_id, action_type, delivered, day_key, created_at) VALUES (?, ?, 'in', 1, '2026-01-01', ?)")
				.bind(`seed-${i}`, actorId, createdAt)
				.run();
		}
	}

	describe('cooldown (gather_cooldown_seconds, default 10)', () => {
		it('rejects the same action type from the same user inside the cooldown', async () => {
			expect((await act(alice, { action_type: 'in' })).status).toBe(201);
			const second = await act(alice, { action_type: 'in' });
			expect(second.status).toBe(429);
			expect(second.body.error.code).toBe('RATE_LIMITED');
			expect(second.body.error.message).toMatch(RATE_MSG);
			const count = await db.prepare("SELECT COUNT(*) AS n FROM rally_actions WHERE action_type = 'in'").first<{ n: number }>();
			expect(count!.n).toBe(1);
		});

		it('allows a different action type and another user', async () => {
			expect((await act(alice, { action_type: 'in' })).status).toBe(201);
			expect((await act(alice, { action_type: 'brb' })).status).toBe(201);
			expect((await act(bob, { action_type: 'in' })).status).toBe(201);
		});

		it('allows the action again once the cooldown has passed', async () => {
			expect((await act(alice, { action_type: 'out' })).status).toBe(201);
			await db.prepare('UPDATE rally_actions SET created_at = ?').bind(new Date(Date.now() - 11_000).toISOString()).run();
			expect((await act(alice, { action_type: 'out' })).status).toBe(201);
		});

		it('covers call, ping, where, judge_time, judge_avail and share_ranking', async () => {
			const calls: Array<[string, unknown?]> = [
				['/api/rally/call', { message: 'go' }],
				['/api/rally/action', { action_type: 'ping', target_user_ids: [bob.userId] }],
				['/api/rally/action', { action_type: 'where', target_user_ids: [bob.userId] }],
				['/api/rally/judge/time'],
				['/api/rally/judge/avail', { target_user_ids: [bob.userId] }],
				['/api/rally/share-ranking'],
			];
			for (const [path, body] of calls) {
				expect((await apiRequest(db, alice.cookie, 'POST', path, body)).status).toBe(201);
				const again = await apiRequest(db, alice.cookie, 'POST', path, body);
				expect(again.status, path).toBe(429);
				expect(again.body.error.code).toBe('RATE_LIMITED');
			}
		});

		it('applies to game shares and tree shares per user', async () => {
			const g1 = await apiRequest(db, alice.cookie, 'POST', '/api/games', { name: 'G1' });
			const g2 = await apiRequest(db, alice.cookie, 'POST', '/api/games', { name: 'G2' });
			expect((await apiRequest(db, alice.cookie, 'POST', `/api/games/${g1.body.data.id}/share`)).status).toBe(201);
			const again = await apiRequest(db, alice.cookie, 'POST', `/api/games/${g2.body.data.id}/share`);
			expect(again.status).toBe(429);
			expect(again.body.error.message).toMatch(RATE_MSG);
			expect((await apiRequest(db, bob.cookie, 'POST', `/api/games/${g2.body.data.id}/share`)).status).toBe(201);

			expect((await apiRequest(db, alice.cookie, 'POST', '/api/rally/tree/share', { image_data: 'AAAA' })).status).toBe(201);
			const tree = await apiRequest(db, alice.cookie, 'POST', '/api/rally/tree/share', { image_data: 'AAAA' });
			expect(tree.status).toBe(429);
			expect(tree.body.error.code).toBe('RATE_LIMITED');
		});

		it('0 disables the cooldown', async () => {
			await setSettingRaw(db, 'gather_cooldown_seconds', 0);
			for (let i = 0; i < 3; i++) expect((await act(alice, { action_type: 'in' })).status).toBe(201);
			const g = await apiRequest(db, alice.cookie, 'POST', '/api/games', { name: 'G' });
			for (let i = 0; i < 2; i++) expect((await apiRequest(db, alice.cookie, 'POST', `/api/games/${g.body.data.id}/share`)).status).toBe(201);
			for (let i = 0; i < 2; i++) expect((await apiRequest(db, alice.cookie, 'POST', '/api/rally/tree/share', { image_data: 'AAAA' })).status).toBe(201);
		});
	});

	describe('hourly limit (gather_hourly_limit, default 30)', () => {
		it('rejects a user who reached the limit in the last 60 minutes', async () => {
			await insertActions(alice.userId, 30, new Date(Date.now() - 30 * 60_000).toISOString());
			const res = await act(alice, { action_type: 'brb' });
			expect(res.status).toBe(429);
			expect(res.body.error.code).toBe('RATE_LIMITED');
			expect(res.body.error.message).toMatch(/Hourly limit reached\. Try again in \d+s/);
			// Other users are not affected
			expect((await act(bob, { action_type: 'brb' })).status).toBe(201);
		});

		it('counts all action types and follows the setting', async () => {
			await setSettingRaw(db, 'gather_hourly_limit', 3);
			expect((await act(alice, { action_type: 'in' })).status).toBe(201);
			expect((await act(alice, { action_type: 'out' })).status).toBe(201);
			expect((await act(alice, { action_type: 'brb' })).status).toBe(201);
			const res = await apiRequest(db, alice.cookie, 'POST', '/api/rally/call', {});
			expect(res.status).toBe(429);
		});

		it('ignores actions older than 60 minutes', async () => {
			await insertActions(alice.userId, 30, new Date(Date.now() - 61 * 60_000).toISOString());
			expect((await act(alice, { action_type: 'brb' })).status).toBe(201);
		});

		it('0 disables the hourly limit', async () => {
			await setSettingRaw(db, 'gather_hourly_limit', 0);
			await insertActions(alice.userId, 40, new Date().toISOString());
			expect((await act(alice, { action_type: 'brb' })).status).toBe(201);
		});
	});
});

describe('Validation of rally and share requests', () => {
	let db: D1Database;
	let alice: { cookie: string; userId: string };
	let bob: { cookie: string; userId: string };

	beforeEach(async () => {
		db = createTestDb();
		alice = await createAuthenticatedUser(db, '50000000000000001', 'alice');
		bob = await createAuthenticatedUser(db, '50000000000000002', 'bob');
		await setSettingRaw(db, 'gather_cooldown_seconds', 0);
	});

	const expect400 = async (path: string, body: unknown) => {
		const res = await apiRequest(db, alice.cookie, 'POST', path, body);
		expect(res.status, `${path} ${JSON.stringify(body)}`).toBe(400);
		expect(res.body.ok).toBe(false);
		expect(res.body.error.code).toBe('BAD_REQUEST');
	};

	it('limits the /call message to 500 characters', async () => {
		await expect400('/api/rally/call', { message: 'x'.repeat(501) });
		await expect400('/api/rally/call', { message: 42 });
		expect((await apiRequest(db, alice.cookie, 'POST', '/api/rally/call', { message: 'x'.repeat(500) })).status).toBe(201);
	});

	it('accepts an empty body on /call', async () => {
		expect((await apiRequest(db, alice.cookie, 'POST', '/api/rally/call')).status).toBe(201);
	});

	it('requires target_user_ids to be 1 to 20 ids of existing users', async () => {
		await expect400('/api/rally/action', { action_type: 'ping', target_user_ids: [] });
		await expect400('/api/rally/action', { action_type: 'ping', target_user_ids: bob.userId });
		await expect400('/api/rally/action', { action_type: 'ping', target_user_ids: [42] });
		await expect400('/api/rally/action', { action_type: 'ping', target_user_ids: ['no-such-user'] });
		await expect400('/api/rally/action', { action_type: 'where', target_user_ids: [bob.userId, 'no-such-user'] });
		await expect400('/api/rally/action', { action_type: 'ping', target_user_ids: Array.from({ length: 21 }, () => bob.userId) });
		await expect400('/api/rally/action', { action_type: 'in', target_user_ids: ['no-such-user'] });
		await expect400('/api/rally/judge/avail', { target_user_ids: ['no-such-user'] });
		await expect400('/api/rally/judge/avail', { target_user_ids: Array.from({ length: 21 }, () => bob.userId) });

		const ok = await apiRequest(db, alice.cookie, 'POST', '/api/rally/action', { action_type: 'ping', target_user_ids: [bob.userId, alice.userId] });
		expect(ok.status).toBe(201);
		expect(ok.body.data.target_user_ids).toEqual([bob.userId, alice.userId]);
		const count = await db.prepare('SELECT COUNT(*) AS n FROM rally_actions').first<{ n: number }>();
		expect(count!.n).toBe(1);
	});

	it('requires a supplied rally_id to exist', async () => {
		await expect400('/api/rally/action', { action_type: 'in', rally_id: 'no-such-rally' });
		await expect400('/api/rally/action', { action_type: 'in', rally_id: 7 });
		const call = await apiRequest(db, alice.cookie, 'POST', '/api/rally/call', {});
		const ok = await apiRequest(db, bob.cookie, 'POST', '/api/rally/action', { action_type: 'in', rally_id: call.body.data.rally.id });
		expect(ok.status).toBe(201);
		expect(ok.body.data.rally_id).toBe(call.body.data.rally.id);
	});

	describe('bodies that are not JSON objects give 400', () => {
		const bodies: Array<[string, string]> = [
			['invalid JSON', '{not json'],
			['array', '[1, 2]'],
			['null', 'null'],
			['string', '"hello"'],
			['number', '7'],
		];
		const paths = ['/api/rally/call', '/api/rally/action', '/api/rally/judge/avail', '/api/rally/tree/share'];
		for (const path of paths) {
			for (const [name, raw] of bodies) {
				it(`${path}: ${name}`, async () => {
					await expect400(path, raw);
				});
			}
		}
	});
});
