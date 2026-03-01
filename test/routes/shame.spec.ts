import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { createTestDb, guildUrl, guildCookie, testEnv } from '../setup';
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
			guildUrl(`/api/shame/${userId2}`),
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Cookie: guildCookie(cookie1) },
				body: JSON.stringify({ reason: 'No-showed last night' }),
			},
			testEnv(db),
		);

		expect(res.status).toBe(201);
		const body = await res.json();
		expect(body.data.target_id).toBe(userId2);
	});

	it('allows self-shaming', async () => {
		const res = await app.request(
			guildUrl(`/api/shame/${userId1}`),
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Cookie: guildCookie(cookie1) },
				body: JSON.stringify({ reason: 'I deserved it' }),
			},
			testEnv(db),
		);

		expect(res.status).toBe(201);
		const body = await res.json();
		expect(body.data.target_id).toBe(userId1);
	});

	it('shows leaderboard', async () => {
		await app.request(
			guildUrl(`/api/shame/${userId2}`),
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Cookie: guildCookie(cookie1) },
				body: JSON.stringify({}),
			},
			testEnv(db),
		);

		const res = await app.request(guildUrl('/api/shame/leaderboard'), { headers: { Cookie: guildCookie(cookie1) } }, testEnv(db));
		const body = await res.json();
		expect(body.data).toHaveLength(1);
		expect(body.data[0].shame_count_today).toBe(1);
		expect(body.data[0].discord_username).toBe('User2');
	});
});
