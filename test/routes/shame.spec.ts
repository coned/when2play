import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { createTestDb } from '../setup';
import { createAuthenticatedUser } from '../helpers';

describe('Shame routes', () => {
	let db: D1Database;
	let cookie1: string;
	let cookie2: string;
	let userId1: string;
	let userId2: string;

	beforeEach(async () => {
		db = createTestDb();
		({ cookie: cookie1, userId: userId1 } = await createAuthenticatedUser(db, '111', 'User1'));
		({ cookie: cookie2, userId: userId2 } = await createAuthenticatedUser(db, '222', 'User2'));
	});

	it('shames another user', async () => {
		const res = await app.request(
			`/api/shame/${userId2}`,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Cookie: cookie1 },
				body: JSON.stringify({ reason: 'No-showed last night' }),
			},
			{ DB: db },
		);

		expect(res.status).toBe(201);
		const body = await res.json();
		expect(body.data.target_id).toBe(userId2);
	});

	it('allows self-shaming', async () => {
		const res = await app.request(
			`/api/shame/${userId1}`,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Cookie: cookie1 },
				body: JSON.stringify({ reason: 'I deserved it' }),
			},
			{ DB: db },
		);

		expect(res.status).toBe(201);
		const body = await res.json();
		expect(body.data.target_id).toBe(userId1);
	});

	it('shows leaderboard', async () => {
		await app.request(
			`/api/shame/${userId2}`,
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Cookie: cookie1 },
				body: JSON.stringify({}),
			},
			{ DB: db },
		);

		const res = await app.request('/api/shame/leaderboard', { headers: { Cookie: cookie1 } }, { DB: db });
		const body = await res.json();
		expect(body.data).toHaveLength(1);
		expect(body.data[0].shame_count).toBe(1);
		expect(body.data[0].discord_username).toBe('User2');
	});
});
