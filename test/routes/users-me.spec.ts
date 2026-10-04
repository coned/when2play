import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../setup';
import { apiRequest, createAuthenticatedAdmin, createAuthenticatedUser } from '../helpers';

describe('GET /api/users', () => {
	let db: D1Database;

	beforeEach(() => {
		db = createTestDb();
	});

	it('leaves out the admin pseudo user', async () => {
		const alice = await createAuthenticatedUser(db, '1001', 'alice');
		const admin = await createAuthenticatedAdmin(db, '1002', 'bob');

		const asUser = await apiRequest(db, alice.cookie, 'GET', '/api/users');
		expect(asUser.status).toBe(200);
		expect(asUser.body.data.map((u: any) => u.discord_username)).toEqual(['alice']);

		// The admin session still works: it is just not in the list
		const asAdmin = await apiRequest(db, admin.cookie, 'GET', '/api/users');
		expect(asAdmin.status).toBe(200);
		expect(asAdmin.body.data.map((u: any) => u.id)).not.toContain(admin.userId);
		const me = await apiRequest(db, admin.cookie, 'GET', '/api/users/me');
		expect(me.body.data.is_admin).toBe(true);
		expect(me.body.data.discord_username).toBe('Administrator');
	});
});

describe('PATCH /api/users/me validation', () => {
	let db: D1Database;
	let cookie: string;

	beforeEach(async () => {
		db = createTestDb();
		({ cookie } = await createAuthenticatedUser(db, '2001', 'carol'));
	});

	const patch = (body: unknown) => apiRequest(db, cookie, 'PATCH', '/api/users/me', body);

	it('ignores discord_username', async () => {
		const res = await patch({ discord_username: 'mallory', display_name: 'Carol' });
		expect(res.status).toBe(200);
		expect(res.body.data.discord_username).toBe('carol');
		expect(res.body.data.display_name).toBe('Carol');
	});

	it('trims display_name and requires 1 to 50 characters', async () => {
		const ok = await patch({ display_name: '  Carol C  ' });
		expect(ok.status).toBe(200);
		expect(ok.body.data.display_name).toBe('Carol C');

		for (const display_name of ['', '   ', 'x'.repeat(51), 42]) {
			const res = await patch({ display_name });
			expect(res.status).toBe(400);
			expect(res.body.error.code).toBe('BAD_REQUEST');
		}
		const fifty = await patch({ display_name: 'y'.repeat(50) });
		expect(fifty.status).toBe(200);
	});

	it('accepts IANA time zones only', async () => {
		for (const timezone of ['America/New_York', 'UTC', 'Europe/Berlin', 'Etc/GMT+5']) {
			const res = await patch({ timezone });
			expect(res.status, timezone).toBe(200);
			expect(res.body.data.timezone).toBe(timezone);
		}
		for (const timezone of ['Mars/Olympus', 'not a zone', '', '+05:00', '<script>', 5]) {
			const res = await patch({ timezone });
			expect(res.status, String(timezone)).toBe(400);
		}
	});

	it('requires an integer granularity from 5 to 60', async () => {
		for (const time_granularity_minutes of [5, 15, 60]) {
			expect((await patch({ time_granularity_minutes })).status).toBe(200);
		}
		for (const time_granularity_minutes of [4, 61, 7.5, '15', null]) {
			expect((await patch({ time_granularity_minutes })).status, String(time_granularity_minutes)).toBe(400);
		}
	});

	it('requires a boolean sync_name_from_discord', async () => {
		const ok = await patch({ sync_name_from_discord: false });
		expect(ok.status).toBe(200);
		expect(ok.body.data.sync_name_from_discord).toBe(0);
		expect((await patch({ sync_name_from_discord: 'yes' })).status).toBe(400);
		expect((await patch({ sync_name_from_discord: 1 })).status).toBe(400);
	});

	it('rejects a body that is not a JSON object', async () => {
		for (const body of ['not json', '[]', 'null', '"text"', '42']) {
			const res = await patch(body);
			expect(res.status, body).toBe(400);
			expect(res.body.error.code).toBe('BAD_REQUEST');
		}
	});
});
