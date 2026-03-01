import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { createTestDb, guildUrl, guildCookie } from '../setup';

describe('User routes', () => {
	let db: D1Database;
	let sessionCookie: string;

	beforeEach(async () => {
		db = createTestDb();

		// Create a user and session
		const tokenRes = await app.request(
			guildUrl('/api/auth/token'),
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ discord_id: '123456', discord_username: 'TestUser', avatar_url: 'https://example.com/avatar.png' }),
			},
			{ DB: db },
		);
		const { data } = await tokenRes.json();
		const callbackRes = await app.request(guildUrl(`/api/auth/callback/${data.token}`), {}, { DB: db });
		const cookie = callbackRes.headers.get('set-cookie')!;
		const sessionId = cookie.match(/session_id=([^;]+)/)![1];
		sessionCookie = `session_id=${sessionId}`;
	});

	describe('GET /api/users/me', () => {
		it('returns current user', async () => {
			const res = await app.request(guildUrl('/api/users/me'), { headers: { Cookie: guildCookie(sessionCookie) } }, { DB: db });

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.ok).toBe(true);
			expect(body.data.discord_username).toBe('TestUser');
			expect(body.data.discord_id).toBe('123456');
			expect(body.data.timezone).toBe('UTC');
		});

		it('returns 401 without session', async () => {
			const res = await app.request(guildUrl('/api/users/me'), {}, { DB: db });
			expect(res.status).toBe(401);
		});
	});

	describe('PATCH /api/users/me', () => {
		it('updates timezone', async () => {
			const res = await app.request(
				guildUrl('/api/users/me'),
				{
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json', Cookie: guildCookie(sessionCookie) },
					body: JSON.stringify({ timezone: 'America/New_York' }),
				},
				{ DB: db },
			);

			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.data.timezone).toBe('America/New_York');
		});

		it('rejects invalid time granularity', async () => {
			const res = await app.request(
				guildUrl('/api/users/me'),
				{
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json', Cookie: guildCookie(sessionCookie) },
					body: JSON.stringify({ time_granularity_minutes: 1 }),
				},
				{ DB: db },
			);

			expect(res.status).toBe(400);
		});
	});
});
