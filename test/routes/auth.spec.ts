import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { createTestDb, guildUrl, guildCookie, TEST_GUILD_ID, testEnv } from '../setup';

describe('Auth routes', () => {
	let db: D1Database;

	beforeEach(() => {
		db = createTestDb();
	});

	describe('POST /api/auth/token', () => {
		it('creates a token for a new user', async () => {
			const res = await app.request(
				guildUrl('/api/auth/token'),
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ discord_id: '123456', discord_username: 'TestUser' }),
				},
				testEnv(db),
			);

			expect(res.status).toBe(201);
			const body = await res.json();
			expect(body.ok).toBe(true);
			expect(body.data.token).toBeDefined();
			expect(body.data.url).toContain('/auth/');
		});

		it('returns 400 if discord_id missing', async () => {
			const res = await app.request(
				guildUrl('/api/auth/token'),
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ discord_username: 'TestUser' }),
				},
				testEnv(db),
			);

			expect(res.status).toBe(400);
		});

		it('returns 400 if discord_id is too long', async () => {
			const res = await app.request(
				guildUrl('/api/auth/token'),
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ discord_id: 'a'.repeat(31), discord_username: 'TestUser' }),
				},
				testEnv(db),
			);

			expect(res.status).toBe(400);
		});

		it('returns 400 if discord_username is too long', async () => {
			const res = await app.request(
				guildUrl('/api/auth/token'),
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ discord_id: '123', discord_username: 'a'.repeat(51) }),
				},
				testEnv(db),
			);

			expect(res.status).toBe(400);
		});

		it('returns 403 when BOT_API_KEY is set and token is wrong', async () => {
			const res = await app.request(
				guildUrl('/api/auth/token'),
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json', 'X-Bot-Token': 'wrong' },
					body: JSON.stringify({ discord_id: '123', discord_username: 'TestUser' }),
				},
				testEnv(db, { BOT_API_KEY: 'correct-key' }),
			);

			expect(res.status).toBe(403);
		});

		it('allows request when BOT_API_KEY matches', async () => {
			const res = await app.request(
				'/api/auth/token',
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json', 'X-Bot-Token': 'my-secret', 'X-Guild-Id': TEST_GUILD_ID },
					body: JSON.stringify({ discord_id: '123', discord_username: 'TestUser' }),
				},
				testEnv(db, { BOT_API_KEY: 'my-secret' }),
			);

			expect(res.status).toBe(201);
		});
	});

	describe('GET /api/auth/callback/:token', () => {
		it('exchanges token for session cookie and redirects', async () => {
			// Create a token first
			const tokenRes = await app.request(
				guildUrl('/api/auth/token'),
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ discord_id: '123456', discord_username: 'TestUser' }),
				},
				testEnv(db),
			);
			const { data } = await tokenRes.json();

			// Exchange token
			const callbackRes = await app.request(guildUrl(`/api/auth/callback/${data.token}`), {}, testEnv(db));

			expect(callbackRes.status).toBe(302);
			const setCookie = callbackRes.headers.get('set-cookie');
			expect(setCookie).toContain('session_id=');
			expect(setCookie).toContain('HttpOnly');
		});

		it('rejects invalid token', async () => {
			const res = await app.request(guildUrl('/api/auth/callback/invalidtoken'), {}, testEnv(db));
			expect(res.status).toBe(401);
		});

		it('rejects already-used token', async () => {
			const tokenRes = await app.request(
				guildUrl('/api/auth/token'),
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ discord_id: '123456', discord_username: 'TestUser' }),
				},
				testEnv(db),
			);
			const { data } = await tokenRes.json();

			// Use token once
			await app.request(guildUrl(`/api/auth/callback/${data.token}`), {}, testEnv(db));

			// Try again
			const res = await app.request(guildUrl(`/api/auth/callback/${data.token}`), {}, testEnv(db));
			expect(res.status).toBe(401);
		});
	});

	describe('POST /api/auth/admin-token', () => {
		it('creates an admin token', async () => {
			const res = await app.request(
				guildUrl('/api/auth/admin-token'),
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json', 'X-Guild-Id': TEST_GUILD_ID },
					body: JSON.stringify({ discord_id: '123456', discord_username: 'AdminUser' }),
				},
				testEnv(db),
			);

			expect(res.status).toBe(201);
			const body = await res.json();
			expect(body.ok).toBe(true);
			expect(body.data.token).toBeDefined();
			expect(body.data.url).toContain('/auth/');
		});

		it('admin callback sets browser-session cookie and is_admin is true', async () => {
			const tokenRes = await app.request(
				guildUrl('/api/auth/admin-token'),
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json', 'X-Guild-Id': TEST_GUILD_ID },
					body: JSON.stringify({ discord_id: '123456', discord_username: 'AdminUser' }),
				},
				testEnv(db),
			);
			const { data } = await tokenRes.json();

			const callbackRes = await app.request(guildUrl(`/api/auth/callback/${data.token}`), {}, testEnv(db));
			expect(callbackRes.status).toBe(302);

			const setCookieHeader = callbackRes.headers.get('set-cookie');
			expect(setCookieHeader).toContain('session_id=');
			expect(setCookieHeader?.toLowerCase()).not.toContain('max-age');

			const sessionId = setCookieHeader!.match(/session_id=([^;]+)/)![1];
			const meRes = await app.request(guildUrl('/api/users/me'), { headers: { Cookie: guildCookie(`session_id=${sessionId}`) } }, testEnv(db));
			const me = await meRes.json();
			expect(me.data.is_admin).toBe(true);
		});

		it('returns 400 when X-Guild-Id header is missing', async () => {
			const res = await app.request(
				guildUrl('/api/auth/admin-token'),
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ discord_id: '123456', discord_username: 'AdminUser' }),
				},
				testEnv(db),
			);

			expect(res.status).toBe(400);
			const body = await res.json();
			expect(body.error.message).toBe('Missing guild context');
		});

		it('admin user gets guild-scoped discord_id', async () => {
			const tokenRes = await app.request(
				guildUrl('/api/auth/admin-token'),
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json', 'X-Guild-Id': TEST_GUILD_ID },
					body: JSON.stringify({ discord_id: '123456', discord_username: 'AdminUser' }),
				},
				testEnv(db),
			);

			expect(tokenRes.status).toBe(201);
			const user = await db.prepare('SELECT discord_id FROM users WHERE discord_id = ?')
				.bind(`system-admin-${TEST_GUILD_ID}`).first<{ discord_id: string }>();
			expect(user).not.toBeNull();
			expect(user!.discord_id).toBe(`system-admin-${TEST_GUILD_ID}`);
		});

		it('migration renames legacy system-admin row', async () => {
			// Insert a legacy system-admin user
			await db.prepare(
				"INSERT INTO users (id, discord_id, discord_username, created_at, updated_at) VALUES ('legacy-id', 'system-admin', 'Administrator', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')"
			).run();

			const res = await app.request(
				guildUrl('/api/auth/admin-token'),
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json', 'X-Guild-Id': TEST_GUILD_ID },
					body: JSON.stringify({ discord_id: '123456', discord_username: 'AdminUser' }),
				},
				testEnv(db),
			);

			expect(res.status).toBe(201);
			const old = await db.prepare('SELECT 1 FROM users WHERE discord_id = ?').bind('system-admin').first();
			expect(old).toBeNull();
			const scoped = await db.prepare('SELECT id FROM users WHERE discord_id = ?')
				.bind(`system-admin-${TEST_GUILD_ID}`).first<{ id: string }>();
			expect(scoped).not.toBeNull();
			expect(scoped!.id).toBe('legacy-id');
		});

		it('migration merges when both rows exist', async () => {
			// Insert legacy system-admin and a scoped row
			await db.prepare(
				"INSERT INTO users (id, discord_id, discord_username, created_at, updated_at) VALUES ('old-id', 'system-admin', 'Administrator', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')"
			).run();
			await db.prepare(
				"INSERT INTO users (id, discord_id, discord_username, created_at, updated_at) VALUES ('scoped-id', ?, 'Administrator', '2024-01-02T00:00:00Z', '2024-01-02T00:00:00Z')"
			).bind(`system-admin-${TEST_GUILD_ID}`).run();

			const res = await app.request(
				guildUrl('/api/auth/admin-token'),
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json', 'X-Guild-Id': TEST_GUILD_ID },
					body: JSON.stringify({ discord_id: '123456', discord_username: 'AdminUser' }),
				},
				testEnv(db),
			);

			expect(res.status).toBe(201);
			const old = await db.prepare('SELECT 1 FROM users WHERE discord_id = ?').bind('system-admin').first();
			expect(old).toBeNull();
			const deleted = await db.prepare('SELECT 1 FROM users WHERE id = ?').bind('scoped-id').first();
			expect(deleted).toBeNull();
			const merged = await db.prepare('SELECT id FROM users WHERE discord_id = ?')
				.bind(`system-admin-${TEST_GUILD_ID}`).first<{ id: string }>();
			expect(merged).not.toBeNull();
			expect(merged!.id).toBe('old-id');
		});

		it('regular token callback sets persistent cookie and is_admin is false', async () => {
			const tokenRes = await app.request(
				guildUrl('/api/auth/token'),
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ discord_id: '789', discord_username: 'RegularUser' }),
				},
				testEnv(db),
			);
			const { data } = await tokenRes.json();

			const callbackRes = await app.request(guildUrl(`/api/auth/callback/${data.token}`), {}, testEnv(db));
			const setCookieHeader = callbackRes.headers.get('set-cookie');
			expect(setCookieHeader?.toLowerCase()).toContain('max-age');

			const sessionId = setCookieHeader!.match(/session_id=([^;]+)/)![1];
			const meRes = await app.request(guildUrl('/api/users/me'), { headers: { Cookie: guildCookie(`session_id=${sessionId}`) } }, testEnv(db));
			const me = await meRes.json();
			expect(me.data.is_admin).toBe(false);
		});
	});

	describe('Multi-guild auth', () => {
		it('auth URL includes ?guild= param when X-Guild-Id header is sent', async () => {
			const res = await app.request(
				guildUrl('/api/auth/token'),
				{
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'X-Bot-Token': 'testkey',
						'X-Guild-Id': TEST_GUILD_ID,
					},
					body: JSON.stringify({ discord_id: '123', discord_username: 'TestUser' }),
				},
				testEnv(db, { BOT_API_KEY: 'testkey' }),
			);

			expect(res.status).toBe(201);
			const body = await res.json();
			expect(body.data.url).toContain(`?guild=${TEST_GUILD_ID}`);
		});

		it('admin-token URL includes ?guild= param when X-Guild-Id header is sent', async () => {
			const res = await app.request(
				guildUrl('/api/auth/admin-token'),
				{
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'X-Bot-Token': 'testkey',
						'X-Guild-Id': TEST_GUILD_ID,
					},
					body: JSON.stringify({ discord_id: '123', discord_username: 'AdminUser' }),
				},
				testEnv(db, { BOT_API_KEY: 'testkey' }),
			);

			expect(res.status).toBe(201);
			const body = await res.json();
			expect(body.data.url).toContain(`?guild=${TEST_GUILD_ID}`);
		});

		it('callback sets guild_id cookie when ?guild= param is present', async () => {
			const tokenRes = await app.request(
				guildUrl('/api/auth/token'),
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ discord_id: '456', discord_username: 'GuildUser' }),
				},
				testEnv(db),
			);
			const { data } = await tokenRes.json();

			const callbackRes = await app.request(
				`/api/auth/callback/${data.token}?guild=${TEST_GUILD_ID}`,
				{},
				testEnv(db),
			);

			expect(callbackRes.status).toBe(302);
			const setCookieHeader = callbackRes.headers.get('set-cookie');
			expect(setCookieHeader).toContain('session_id=');
			expect(setCookieHeader).toContain(`guild_id=${TEST_GUILD_ID}`);
		});

		it('callback does not set guild_id cookie when ?guild= param is absent', async () => {
			const tokenRes = await app.request(
				guildUrl('/api/auth/token'),
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ discord_id: '789', discord_username: 'NoGuildUser' }),
				},
				testEnv(db),
			);
			const { data } = await tokenRes.json();

			// Use guild_id cookie for middleware routing, but no ?guild= query param
			// so the callback handler should not set a guild_id cookie
			const callbackRes = await app.request(
				`/api/auth/callback/${data.token}`,
				{ headers: { Cookie: `guild_id=${TEST_GUILD_ID}` } },
				testEnv(db),
			);

			expect(callbackRes.status).toBe(302);
			const setCookieHeader = callbackRes.headers.get('set-cookie');
			expect(setCookieHeader).toContain('session_id=');
			expect(setCookieHeader).not.toContain(`guild_id=${TEST_GUILD_ID};`);
		});

		it('logout deletes guild_id cookie', async () => {
			const tokenRes = await app.request(
				guildUrl('/api/auth/token'),
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ discord_id: '321', discord_username: 'LogoutUser' }),
				},
				testEnv(db),
			);
			const { data } = await tokenRes.json();
			const callbackRes = await app.request(
				`/api/auth/callback/${data.token}?guild=${TEST_GUILD_ID}`,
				{},
				testEnv(db),
			);
			const cookie = callbackRes.headers.get('set-cookie')!;
			const sessionId = cookie.match(/session_id=([^;]+)/)![1];

			const logoutRes = await app.request(
				guildUrl('/api/auth/logout'),
				{
					method: 'POST',
					headers: { Cookie: guildCookie(`session_id=${sessionId}`) },
				},
				testEnv(db),
			);

			expect(logoutRes.status).toBe(200);
			const logoutCookie = logoutRes.headers.get('set-cookie');
			expect(logoutCookie).toContain('guild_id=');
		});
	});

	describe('POST /api/auth/logout', () => {
		it('destroys session', async () => {
			// Create user and session
			const tokenRes = await app.request(
				guildUrl('/api/auth/token'),
				{
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ discord_id: '123456', discord_username: 'TestUser' }),
				},
				testEnv(db),
			);
			const { data } = await tokenRes.json();

			const callbackRes = await app.request(guildUrl(`/api/auth/callback/${data.token}`), {}, testEnv(db));
			const cookie = callbackRes.headers.get('set-cookie')!;
			const sessionId = cookie.match(/session_id=([^;]+)/)![1];

			// Logout
			const logoutRes = await app.request(
				guildUrl('/api/auth/logout'),
				{
					method: 'POST',
					headers: { Cookie: guildCookie(`session_id=${sessionId}`) },
				},
				testEnv(db),
			);

			expect(logoutRes.status).toBe(200);

			// Verify session is invalid now
			const meRes = await app.request(guildUrl('/api/users/me'), { headers: { Cookie: guildCookie(`session_id=${sessionId}`) } }, testEnv(db));
			expect(meRes.status).toBe(401);
		});
	});
});
