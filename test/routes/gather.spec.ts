import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { createTestDb, guildUrl, guildCookie } from '../setup';
import { createAuthenticatedUser } from '../helpers';

describe('Gather routes', () => {
	let db: D1Database;
	let cookie: string;
	let userId: string;

	beforeEach(async () => {
		db = createTestDb();
		({ cookie, userId } = await createAuthenticatedUser(db, '123', 'TestUser'));
	});

	it('rings the gather bell', async () => {
		const res = await app.request(
			guildUrl('/api/gather'),
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Cookie: guildCookie(cookie) },
				body: JSON.stringify({ message: "Let's play!" }),
			},
			{ DB: db },
		);

		expect(res.status).toBe(201);
		const body = await res.json();
		expect(body.data.message).toBe("Let's play!");
		expect(body.data.delivered).toBe(false);
	});

	it('returns pending pings', async () => {
		await app.request(
			guildUrl('/api/gather'),
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Cookie: guildCookie(cookie) },
				body: JSON.stringify({}),
			},
			{ DB: db },
		);

		const pendingRes = await app.request(guildUrl('/api/gather/pending'), { headers: { Cookie: guildCookie(cookie) } }, { DB: db });
		const pending = await pendingRes.json();
		expect(pending.data).toHaveLength(1);
	});

	it('marks ping as delivered', async () => {
		const createRes = await app.request(
			guildUrl('/api/gather'),
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Cookie: guildCookie(cookie) },
				body: JSON.stringify({}),
			},
			{ DB: db },
		);
		const { data: ping } = await createRes.json();

		await app.request(guildUrl(`/api/gather/${ping.id}/delivered`), { method: 'PATCH', headers: { Cookie: guildCookie(cookie) } }, { DB: db });

		const pendingRes = await app.request(guildUrl('/api/gather/pending'), { headers: { Cookie: guildCookie(cookie) } }, { DB: db });
		const pending = await pendingRes.json();
		expect(pending.data).toHaveLength(0);
	});

	it('enforces per-ping cooldown', async () => {
		// First ping succeeds
		const res1 = await app.request(
			guildUrl('/api/gather'),
			{ method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: guildCookie(cookie) }, body: JSON.stringify({}) },
			{ DB: db },
		);
		expect(res1.status).toBe(201);

		// Immediate second ping is blocked by 10s cooldown
		const res2 = await app.request(
			guildUrl('/api/gather'),
			{ method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: guildCookie(cookie) }, body: JSON.stringify({}) },
			{ DB: db },
		);
		expect(res2.status).toBe(429);
		const body = await res2.json();
		expect(body.error.code).toBe('RATE_LIMITED');
	});

	it('enforces hourly limit', async () => {
		// Insert 30 pings directly to bypass per-ping cooldown
		const since = Date.now() - 3600000;
		for (let i = 0; i < 30; i++) {
			const id = crypto.randomUUID();
			const created = new Date(since + (i + 1) * 1000).toISOString();
			await db
				.prepare('INSERT INTO gather_pings (id, user_id, message, delivered, is_anonymous, target_user_ids, created_at) VALUES (?, ?, null, 0, 0, null, ?)')
				.bind(id, userId, created)
				.run();
		}

		// 31st ping should be blocked by hourly limit
		const res = await app.request(
			guildUrl('/api/gather'),
			{ method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: guildCookie(cookie) }, body: JSON.stringify({}) },
			{ DB: db },
		);
		expect(res.status).toBe(429);
		const body = await res.json();
		expect(body.error.code).toBe('RATE_LIMITED');
		expect(body.error.message).toContain('Hourly limit');
	});
});
