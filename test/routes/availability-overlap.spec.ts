import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { createTestDb, guildUrl, guildCookie, testEnv } from '../setup';
import { createAuthenticatedUser } from '../helpers';

describe('Availability overlap (multi-user consensus)', () => {
	let db: D1Database;
	let user1Cookie: string;
	let user2Cookie: string;
	let user3Cookie: string;
	let user1Id: string;
	let user2Id: string;
	let user3Id: string;

	beforeEach(async () => {
		db = createTestDb();
		({ cookie: user1Cookie, userId: user1Id } = await createAuthenticatedUser(db, '101', 'Alice'));
		({ cookie: user2Cookie, userId: user2Id } = await createAuthenticatedUser(db, '102', 'Bob'));
		({ cookie: user3Cookie, userId: user3Id } = await createAuthenticatedUser(db, '103', 'Carol'));
	});

	async function setAvail(cookie: string, date: string, slots: Array<{ start_time: string; end_time: string }>) {
		return app.request(
			guildUrl('/api/availability'),
			{
				method: 'PUT',
				headers: { 'Content-Type': 'application/json', Cookie: guildCookie(cookie) },
				body: JSON.stringify({ date, slots }),
			},
			testEnv(db),
		);
	}

	async function getAvail(cookie: string, date: string) {
		const res = await app.request(
			guildUrl(`/api/availability?date=${date}`),
			{ headers: { Cookie: guildCookie(cookie) } },
			testEnv(db),
		);
		return res.json();
	}

	it('returns all users slots for a date', async () => {
		await setAvail(user1Cookie, '2026-03-05', [
			{ start_time: '19:00', end_time: '19:15' },
			{ start_time: '19:15', end_time: '19:30' },
		]);
		await setAvail(user2Cookie, '2026-03-05', [
			{ start_time: '19:00', end_time: '19:15' },
		]);

		const result = await getAvail(user1Cookie, '2026-03-05');
		expect(result.data).toHaveLength(3); // 2 from user1 + 1 from user2
	});

	it('supports computing overlap counts from returned data', async () => {
		const date = '2026-03-05';
		await setAvail(user1Cookie, date, [
			{ start_time: '19:00', end_time: '19:15' },
			{ start_time: '20:00', end_time: '20:15' },
		]);
		await setAvail(user2Cookie, date, [
			{ start_time: '19:00', end_time: '19:15' },
			{ start_time: '20:00', end_time: '20:15' },
		]);
		await setAvail(user3Cookie, date, [
			{ start_time: '19:00', end_time: '19:15' },
		]);

		const result = await getAvail(user1Cookie, date);
		const slots = result.data as Array<{ start_time: string; user_id: string }>;

		// Build overlap map (same logic as TimeGrid otherUsers)
		const overlapMap = new Map<string, Set<string>>();
		for (const s of slots) {
			if (s.user_id === user1Id) continue;
			if (!overlapMap.has(s.start_time)) overlapMap.set(s.start_time, new Set());
			overlapMap.get(s.start_time)!.add(s.user_id);
		}

		// 19:00 has user2 + user3 = 2 others
		expect(overlapMap.get('19:00')?.size).toBe(2);
		// 20:00 has user2 = 1 other
		expect(overlapMap.get('20:00')?.size).toBe(1);
	});

	it('supports computing total participants from returned data', async () => {
		const date = '2026-03-05';
		await setAvail(user1Cookie, date, [{ start_time: '19:00', end_time: '19:15' }]);
		await setAvail(user2Cookie, date, [{ start_time: '20:00', end_time: '20:15' }]);
		await setAvail(user3Cookie, date, [{ start_time: '21:00', end_time: '21:15' }]);

		const result = await getAvail(user1Cookie, date);
		const slots = result.data as Array<{ user_id: string }>;

		// Count distinct other user_ids (same logic as AvailabilityView totalParticipants)
		const others = new Set<string>();
		for (const s of slots) {
			if (s.user_id !== user1Id) others.add(s.user_id);
		}
		expect(others.size).toBe(2); // user2 and user3
	});

	it('returns empty overlap when only one user has availability', async () => {
		const date = '2026-03-05';
		await setAvail(user1Cookie, date, [
			{ start_time: '19:00', end_time: '19:15' },
			{ start_time: '19:15', end_time: '19:30' },
		]);

		const result = await getAvail(user1Cookie, date);
		const slots = result.data as Array<{ user_id: string }>;

		const others = new Set<string>();
		for (const s of slots) {
			if (s.user_id !== user1Id) others.add(s.user_id);
		}
		expect(others.size).toBe(0);
	});

	it('returns no data when no users have availability for a date', async () => {
		const result = await getAvail(user1Cookie, '2026-03-10');
		expect(result.data).toHaveLength(0);
	});

	it('each user slots are independent and replaceable', async () => {
		const date = '2026-03-05';

		// User1 sets 19:00
		await setAvail(user1Cookie, date, [{ start_time: '19:00', end_time: '19:15' }]);
		// User2 sets 19:00 and 20:00
		await setAvail(user2Cookie, date, [
			{ start_time: '19:00', end_time: '19:15' },
			{ start_time: '20:00', end_time: '20:15' },
		]);

		let result = await getAvail(user1Cookie, date);
		expect(result.data).toHaveLength(3);

		// User2 replaces with just 20:00
		await setAvail(user2Cookie, date, [{ start_time: '20:00', end_time: '20:15' }]);

		result = await getAvail(user1Cookie, date);
		expect(result.data).toHaveLength(2); // user1 19:00 + user2 20:00

		// 19:00 now only has user1 (no overlap)
		const at19 = result.data.filter((s: any) => s.start_time === '19:00');
		expect(at19).toHaveLength(1);
		expect(at19[0].user_id).toBe(user1Id);
	});
});
