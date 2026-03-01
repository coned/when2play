import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { createTestDb, guildUrl, guildCookie } from '../setup';
import { createAuthenticatedUser, createAuthenticatedAdmin } from '../helpers';

describe('Settings routes', () => {
	let db: D1Database;
	let userCookie: string;
	let adminCookie: string;

	beforeEach(async () => {
		db = createTestDb();
		({ cookie: userCookie } = await createAuthenticatedUser(db, '111', 'RegularUser'));
		({ cookie: adminCookie } = await createAuthenticatedAdmin(db, '222', 'AdminUser'));
	});

	it('GET /api/settings returns settings for any authenticated user', async () => {
		const res = await app.request(guildUrl('/api/settings'), { headers: { Cookie: guildCookie(userCookie) } }, { DB: db });
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.ok).toBe(true);
		expect(body.data).toBeDefined();
	});

	it('PATCH /api/settings returns 403 for non-admin', async () => {
		const res = await app.request(
			guildUrl('/api/settings'),
			{
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json', Cookie: guildCookie(userCookie) },
				body: JSON.stringify({ gather_cooldown_seconds: 60 }),
			},
			{ DB: db },
		);
		expect(res.status).toBe(403);
		const body = await res.json();
		expect(body.error.code).toBe('FORBIDDEN');
	});

	it('PATCH /api/settings succeeds for admin', async () => {
		const res = await app.request(
			guildUrl('/api/settings'),
			{
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json', Cookie: guildCookie(adminCookie) },
				body: JSON.stringify({ gather_cooldown_seconds: 60 }),
			},
			{ DB: db },
		);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.ok).toBe(true);
		expect(body.data.gather_cooldown_seconds).toBe(60);
	});
});
