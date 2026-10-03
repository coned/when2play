import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import app from '../../src/index';
import { createTestDb, guildUrl, guildCookie, testEnv } from '../setup';
import { createAuthenticatedUser } from '../helpers';

type Window = { start: string; end: string; user_count: number; user_ids: string[]; user_names: string[] };

function fmt(minutes: number): string {
	const m = ((minutes % 1440) + 1440) % 1440;
	return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** 15 minute rows from start (inclusive) to end (exclusive), in minutes; end may pass 24:00. */
function rows(fromMin: number, toMin: number) {
	const out: Array<{ start_time: string; end_time: string }> = [];
	for (let t = fromMin; t < toMin; t += 15) out.push({ start_time: fmt(t), end_time: fmt(t + 15) });
	return out;
}

describe('POST /api/rally/judge/time across UTC midnight', () => {
	let db: D1Database;
	let aliceCookie: string;
	let bobCookie: string;
	let aliceId: string;
	let bobId: string;

	beforeEach(async () => {
		// 4 PM EDT on 2026-07-15: day key 2026-07-15, grid origin 17 ET = 21:00 UTC
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-07-15T20:00:00Z'));
		db = createTestDb();
		({ cookie: aliceCookie, userId: aliceId } = await createAuthenticatedUser(db, '201', 'Alice'));
		({ cookie: bobCookie, userId: bobId } = await createAuthenticatedUser(db, '202', 'Bob'));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	async function setAvail(cookie: string, slots: Array<{ start_time: string; end_time: string }>) {
		const res = await app.request(
			guildUrl('/api/availability'),
			{
				method: 'PUT',
				headers: { 'Content-Type': 'application/json', Cookie: guildCookie(cookie) },
				body: JSON.stringify({ date: '2026-07-15', slots }),
			},
			testEnv(db),
		);
		expect(res.status).toBe(200);
	}

	async function judge(): Promise<{ windows: Window[]; day_key: string }> {
		const res = await app.request(
			guildUrl('/api/rally/judge/time'),
			{ method: 'POST', headers: { Cookie: guildCookie(aliceCookie) } },
			testEnv(db),
		);
		expect(res.status).toBe(201);
		const json = await res.json();
		return json.data.metadata;
	}

	it('merges a 21:00 to 02:00 UTC range into one window', async () => {
		// 21:00 .. 02:00 UTC = 5 PM to 10 PM EDT, includes the 23:45 -> 00:00 row
		const slots = rows(21 * 60, 26 * 60);
		expect(slots).toContainEqual({ start_time: '23:45', end_time: '00:00' });
		await setAvail(aliceCookie, slots);
		await setAvail(bobCookie, slots);

		const meta = await judge();
		expect(meta.day_key).toBe('2026-07-15');
		expect(meta.windows).toHaveLength(1);
		expect(meta.windows[0]).toMatchObject({ start: '21:00', end: '02:00', user_count: 2 });
		expect([...meta.windows[0].user_ids].sort()).toEqual([aliceId, bobId].sort());
		expect([...meta.windows[0].user_names].sort()).toEqual(['Alice', 'Bob']);
	});

	it('lists a window before UTC midnight first when user counts are equal', async () => {
		const slots = [...rows(21 * 60, 22 * 60), ...rows(24 * 60 + 30, 25 * 60)];
		await setAvail(aliceCookie, slots);
		await setAvail(bobCookie, slots);

		const meta = await judge();
		expect(meta.windows.map((w) => [w.start, w.end, w.user_count])).toEqual([
			['21:00', '22:00', 2],
			['00:30', '01:00', 2],
		]);
	});

	it('still sorts by user_count first', async () => {
		const { cookie: carolCookie } = await createAuthenticatedUser(db, '203', 'Carol');
		await setAvail(aliceCookie, [...rows(21 * 60, 22 * 60), ...rows(24 * 60, 25 * 60)]);
		await setAvail(bobCookie, [...rows(21 * 60, 22 * 60), ...rows(24 * 60, 25 * 60)]);
		await setAvail(carolCookie, rows(24 * 60, 25 * 60));

		const meta = await judge();
		expect(meta.windows.map((w) => [w.start, w.end, w.user_count])).toEqual([
			['00:00', '01:00', 3],
			['21:00', '22:00', 2],
		]);
	});
});
