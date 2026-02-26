import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { createTestDb } from '../setup';

describe('Auth routes', () => {
	let db: D1Database;

	beforeEach(() => {
		db = createTestDb();
	});

	describe('POST /api/auth/token', () => {
		it('creates a token for a new user', async () => {
			const res = await app.request(
				'/api/auth/token',
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ discord_id: '123456', discord_username: 'TestUser' }),
				},
				{ DB: db },
			);

			expect(res.status).toBe(201);
			const body = await res.json();
			expect(body.ok).toBe(true);
			expect(body.data.token).toBeDefined();
			expect(body.data.url).toContain('/auth/');
		});

		it('returns 400 if discord_id missing', async () => {
			const res = await app.request(
				'/api/auth/token',
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ discord_username: 'TestUser' }),
				},
				{ DB: db },
			);

			expect(res.status).toBe(400);
		});

		it('returns 400 if discord_id is too long', async () => {
			const res = await app.request(
				'/api/auth/token',
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ discord_id: 'a'.repeat(31), discord_username: 'TestUser' }),
				},
				{ DB: db },
			);

			expect(res.status).toBe(400);
		});

		it('returns 400 if discord_username is too long', async () => {
			const res = await app.request(
				'/api/auth/token',
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ discord_id: '123', discord_username: 'a'.repeat(51) }),
				},
				{ DB: db },
			);

			expect(res.status).toBe(400);
		});

		it('returns 403 when BOT_API_KEY is set and token is wrong', async () => {
			const res = await app.request(
				'/api/auth/token',
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json', 'X-Bot-Token': 'wrong' },
					body: JSON.stringify({ discord_id: '123', discord_username: 'TestUser' }),
				},
				{ DB: db, BOT_API_KEY: 'correct-key' },
			);

			expect(res.status).toBe(403);
		});

		it('allows request when BOT_API_KEY matches', async () => {
			const res = await app.request(
				'/api/auth/token',
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json', 'X-Bot-Token': 'my-secret' },
					body: JSON.stringify({ discord_id: '123', discord_username: 'TestUser' }),
				},
				{ DB: db, BOT_API_KEY: 'my-secret' },
			);

			expect(res.status).toBe(201);
		});
	});

	describe('GET /api/auth/callback/:token', () => {
		it('exchanges token for session cookie and redirects', async () => {
			// Create a token first
			const tokenRes = await app.request(
				'/api/auth/token',
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ discord_id: '123456', discord_username: 'TestUser' }),
				},
				{ DB: db },
			);
			const { data } = await tokenRes.json();

			// Exchange token
			const callbackRes = await app.request(`/api/auth/callback/${data.token}`, {}, { DB: db });

			expect(callbackRes.status).toBe(302);
			const setCookie = callbackRes.headers.get('set-cookie');
			expect(setCookie).toContain('session_id=');
			expect(setCookie).toContain('HttpOnly');
		});

		it('rejects invalid token', async () => {
			const res = await app.request('/api/auth/callback/invalidtoken', {}, { DB: db });
			expect(res.status).toBe(401);
		});

		it('rejects already-used token', async () => {
			const tokenRes = await app.request(
				'/api/auth/token',
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ discord_id: '123456', discord_username: 'TestUser' }),
				},
				{ DB: db },
			);
			const { data } = await tokenRes.json();

			// Use token once
			await app.request(`/api/auth/callback/${data.token}`, {}, { DB: db });

			// Try again
			const res = await app.request(`/api/auth/callback/${data.token}`, {}, { DB: db });
			expect(res.status).toBe(401);
		});
	});

	describe('POST /api/auth/admin-token', () => {
		it('creates an admin token', async () => {
			const res = await app.request(
				'/api/auth/admin-token',
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ discord_id: '123456', discord_username: 'AdminUser' }),
				},
				{ DB: db },
			);

			expect(res.status).toBe(201);
			const body = await res.json();
			expect(body.ok).toBe(true);
			expect(body.data.token).toBeDefined();
			expect(body.data.url).toContain('/auth/');
		});

		it('admin callback sets browser-session cookie and is_admin is true', async () => {
			const tokenRes = await app.request(
				'/api/auth/admin-token',
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ discord_id: '123456', discord_username: 'AdminUser' }),
				},
				{ DB: db },
			);
			const { data } = await tokenRes.json();

			const callbackRes = await app.request(`/api/auth/callback/${data.token}`, {}, { DB: db });
			expect(callbackRes.status).toBe(302);

			const setCookieHeader = callbackRes.headers.get('set-cookie');
			expect(setCookieHeader).toContain('session_id=');
			expect(setCookieHeader?.toLowerCase()).not.toContain('max-age');

			const sessionId = setCookieHeader!.match(/session_id=([^;]+)/)![1];
			const meRes = await app.request('/api/users/me', { headers: { Cookie: `session_id=${sessionId}` } }, { DB: db });
			const me = await meRes.json();
			expect(me.data.is_admin).toBe(true);
		});

		it('regular token callback sets persistent cookie and is_admin is false', async () => {
			const tokenRes = await app.request(
				'/api/auth/token',
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ discord_id: '789', discord_username: 'RegularUser' }),
				},
				{ DB: db },
			);
			const { data } = await tokenRes.json();

			const callbackRes = await app.request(`/api/auth/callback/${data.token}`, {}, { DB: db });
			const setCookieHeader = callbackRes.headers.get('set-cookie');
			expect(setCookieHeader?.toLowerCase()).toContain('max-age');

			const sessionId = setCookieHeader!.match(/session_id=([^;]+)/)![1];
			const meRes = await app.request('/api/users/me', { headers: { Cookie: `session_id=${sessionId}` } }, { DB: db });
			const me = await meRes.json();
			expect(me.data.is_admin).toBe(false);
		});
	});

	describe('POST /api/auth/logout', () => {
		it('destroys session', async () => {
			// Create user and session
			const tokenRes = await app.request(
				'/api/auth/token',
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ discord_id: '123456', discord_username: 'TestUser' }),
				},
				{ DB: db },
			);
			const { data } = await tokenRes.json();

			const callbackRes = await app.request(`/api/auth/callback/${data.token}`, {}, { DB: db });
			const cookie = callbackRes.headers.get('set-cookie')!;
			const sessionId = cookie.match(/session_id=([^;]+)/)![1];

			// Logout
			const logoutRes = await app.request(
				'/api/auth/logout',
				{
					method: 'POST',
					headers: { Cookie: `session_id=${sessionId}` },
				},
				{ DB: db },
			);

			expect(logoutRes.status).toBe(200);

			// Verify session is invalid now
			const meRes = await app.request('/api/users/me', { headers: { Cookie: `session_id=${sessionId}` } }, { DB: db });
			expect(meRes.status).toBe(401);
		});
	});
});
