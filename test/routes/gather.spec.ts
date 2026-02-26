import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { createTestDb } from '../setup';
import { createAuthenticatedUser } from '../helpers';

describe('Gather routes', () => {
	let db: D1Database;
	let cookie: string;

	beforeEach(async () => {
		db = createTestDb();
		({ cookie } = await createAuthenticatedUser(db, '123', 'TestUser'));
	});

	it('rings the gather bell', async () => {
		const res = await app.request(
			'/api/gather',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Cookie: cookie },
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
			'/api/gather',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Cookie: cookie },
				body: JSON.stringify({}),
			},
			{ DB: db },
		);

		const pendingRes = await app.request('/api/gather/pending', { headers: { Cookie: cookie } }, { DB: db });
		const pending = await pendingRes.json();
		expect(pending.data).toHaveLength(1);
	});

	it('marks ping as delivered', async () => {
		const createRes = await app.request(
			'/api/gather',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Cookie: cookie },
				body: JSON.stringify({}),
			},
			{ DB: db },
		);
		const { data: ping } = await createRes.json();

		await app.request(`/api/gather/${ping.id}/delivered`, { method: 'PATCH', headers: { Cookie: cookie } }, { DB: db });

		const pendingRes = await app.request('/api/gather/pending', { headers: { Cookie: cookie } }, { DB: db });
		const pending = await pendingRes.json();
		expect(pending.data).toHaveLength(0);
	});
});
