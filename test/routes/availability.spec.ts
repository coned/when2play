import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { createTestDb } from '../setup';
import { createAuthenticatedUser } from '../helpers';

describe('Availability routes', () => {
	let db: D1Database;
	let cookie: string;

	beforeEach(async () => {
		db = createTestDb();
		({ cookie } = await createAuthenticatedUser(db, '123', 'TestUser'));
	});

	it('sets and retrieves availability', async () => {
		const setRes = await app.request(
			'/api/availability',
			{
				method: 'PUT',
				headers: { 'Content-Type': 'application/json', Cookie: cookie },
				body: JSON.stringify({
					date: '2026-03-01',
					slots: [
						{ start_time: '19:00', end_time: '19:15' },
						{ start_time: '19:15', end_time: '19:30' },
					],
				}),
			},
			{ DB: db },
		);

		expect(setRes.status).toBe(200);
		const set = await setRes.json();
		expect(set.data).toHaveLength(2);

		const getRes = await app.request('/api/availability?date=2026-03-01', { headers: { Cookie: cookie } }, { DB: db });
		const get = await getRes.json();
		expect(get.data).toHaveLength(2);
	});

	it('replaces existing slots on same date', async () => {
		// Set initial
		await app.request(
			'/api/availability',
			{
				method: 'PUT',
				headers: { 'Content-Type': 'application/json', Cookie: cookie },
				body: JSON.stringify({ date: '2026-03-01', slots: [{ start_time: '19:00', end_time: '19:15' }] }),
			},
			{ DB: db },
		);

		// Replace
		await app.request(
			'/api/availability',
			{
				method: 'PUT',
				headers: { 'Content-Type': 'application/json', Cookie: cookie },
				body: JSON.stringify({ date: '2026-03-01', slots: [{ start_time: '20:00', end_time: '20:15' }] }),
			},
			{ DB: db },
		);

		const getRes = await app.request('/api/availability?date=2026-03-01', { headers: { Cookie: cookie } }, { DB: db });
		const get = await getRes.json();
		expect(get.data).toHaveLength(1);
		expect(get.data[0].start_time).toBe('20:00');
	});

	it('clears availability', async () => {
		await app.request(
			'/api/availability',
			{
				method: 'PUT',
				headers: { 'Content-Type': 'application/json', Cookie: cookie },
				body: JSON.stringify({ date: '2026-03-01', slots: [{ start_time: '19:00', end_time: '19:15' }] }),
			},
			{ DB: db },
		);

		const deleteRes = await app.request(
			'/api/availability?date=2026-03-01',
			{ method: 'DELETE', headers: { Cookie: cookie } },
			{ DB: db },
		);
		expect(deleteRes.status).toBe(200);

		const getRes = await app.request('/api/availability?date=2026-03-01', { headers: { Cookie: cookie } }, { DB: db });
		const get = await getRes.json();
		expect(get.data).toHaveLength(0);
	});
});
