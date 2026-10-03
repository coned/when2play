import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { createTestDb, guildUrl, guildCookie, testEnv } from '../setup';
import { createAuthenticatedUser } from '../helpers';

describe('PUT /api/availability validation and atomic replace', () => {
	let db: D1Database;
	let cookie: string;

	beforeEach(async () => {
		db = createTestDb();
		({ cookie } = await createAuthenticatedUser(db, '123', 'TestUser'));
	});

	function put(body: string) {
		return app.request(
			guildUrl('/api/availability'),
			{
				method: 'PUT',
				headers: { 'Content-Type': 'application/json', Cookie: guildCookie(cookie) },
				body,
			},
			testEnv(db),
		);
	}

	async function getMine(date: string) {
		const res = await app.request(guildUrl(`/api/availability?date=${date}`), { headers: { Cookie: guildCookie(cookie) } }, testEnv(db));
		const json = await res.json();
		return json.data as Array<{ start_time: string; end_time: string; slot_status: string }>;
	}

	const slot = { start_time: '19:00', end_time: '19:15' };

	const invalidBodies: Array<[string, string]> = [
		['invalid JSON', '{"date": "2026-03-01", "slots": ['],
		['non-object body', '"hello"'],
		['missing date', JSON.stringify({ slots: [slot] })],
		['malformed date', JSON.stringify({ date: '2026-3-1', slots: [slot] })],
		['impossible date', JSON.stringify({ date: '2026-02-30', slots: [slot] })],
		['missing slots', JSON.stringify({ date: '2026-03-01' })],
		['slots not an array', JSON.stringify({ date: '2026-03-01', slots: { start_time: '19:00', end_time: '19:15' } })],
		['more than 96 slots', JSON.stringify({ date: '2026-03-01', slots: Array.from({ length: 97 }, () => slot) })],
		['slot not an object', JSON.stringify({ date: '2026-03-01', slots: ['19:00'] })],
		['bad start_time', JSON.stringify({ date: '2026-03-01', slots: [{ start_time: '24:00', end_time: '00:15' }] })],
		['short start_time', JSON.stringify({ date: '2026-03-01', slots: [{ start_time: '9:00', end_time: '09:15' }] })],
		['missing end_time', JSON.stringify({ date: '2026-03-01', slots: [{ start_time: '19:00' }] })],
		['bad end_time', JSON.stringify({ date: '2026-03-01', slots: [{ start_time: '19:00', end_time: '19:60' }] })],
		['bad slot_status', JSON.stringify({ date: '2026-03-01', slots: [{ ...slot, slot_status: 'maybe' }] })],
	];

	for (const [label, body] of invalidBodies) {
		it(`rejects ${label} with 400`, async () => {
			const res = await put(body);
			expect(res.status).toBe(400);
			const json = await res.json();
			expect(json.ok).toBe(false);
			expect(json.error.code).toBe('BAD_REQUEST');
		});
	}

	it('rejects an invalid request without touching existing slots', async () => {
		await put(JSON.stringify({ date: '2026-03-01', slots: [slot] }));
		const res = await put(JSON.stringify({ date: '2026-03-01', slots: [{ start_time: 'xx', end_time: '19:15' }] }));
		expect(res.status).toBe(400);
		expect(await getMine('2026-03-01')).toHaveLength(1);
	});

	it('accepts exactly 96 slots', async () => {
		const slots = Array.from({ length: 96 }, (_, i) => {
			const start = i * 15;
			const end = (start + 15) % 1440;
			const fmt = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
			return { start_time: fmt(start), end_time: fmt(end) };
		});
		const res = await put(JSON.stringify({ date: '2026-03-01', slots }));
		expect(res.status).toBe(200);
		expect(await getMine('2026-03-01')).toHaveLength(96);
	});

	it('collapses duplicate start times instead of failing (last one wins)', async () => {
		const res = await put(JSON.stringify({
			date: '2026-03-01',
			slots: [
				{ start_time: '19:00', end_time: '19:15', slot_status: 'available' },
				{ start_time: '19:15', end_time: '19:30' },
				{ start_time: '19:00', end_time: '19:15', slot_status: 'tentative' },
			],
		}));
		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.data).toHaveLength(2);

		const mine = await getMine('2026-03-01');
		expect(mine).toHaveLength(2);
		expect(mine.find((s) => s.start_time === '19:00')?.slot_status).toBe('tentative');
	});

	it('replaces the previous slots on a valid save', async () => {
		await put(JSON.stringify({
			date: '2026-03-01',
			slots: [
				{ start_time: '19:00', end_time: '19:15' },
				{ start_time: '19:15', end_time: '19:30' },
			],
		}));
		const res = await put(JSON.stringify({
			date: '2026-03-01',
			slots: [{ start_time: '23:45', end_time: '00:00', slot_status: 'tentative' }],
		}));
		expect(res.status).toBe(200);

		const mine = await getMine('2026-03-01');
		expect(mine).toHaveLength(1);
		expect(mine[0]).toMatchObject({ start_time: '23:45', end_time: '00:00', slot_status: 'tentative' });
	});

	it('confirm copies all of last week\'s slots and marks the day confirmed', async () => {
		await put(JSON.stringify({
			date: '2026-03-01',
			slots: [
				{ start_time: '23:45', end_time: '00:00' },
				{ start_time: '00:00', end_time: '00:15', slot_status: 'tentative' },
			],
		}));
		const res = await app.request(
			guildUrl('/api/availability/2026-03-08/confirm'),
			{ method: 'POST', headers: { Cookie: guildCookie(cookie) } },
			testEnv(db),
		);
		expect(res.status).toBe(200);

		const mine = await getMine('2026-03-08');
		expect(mine.map((s) => [s.start_time, s.slot_status]).sort()).toEqual([
			['00:00', 'tentative'],
			['23:45', 'available'],
		]);

		const statusRes = await app.request(
			guildUrl('/api/availability/my-status?from=2026-03-08&to=2026-03-08'),
			{ headers: { Cookie: guildCookie(cookie) } },
			testEnv(db),
		);
		expect((await statusRes.json()).data['2026-03-08'].status).toBe('confirmed');
	});

	it('DELETE rejects an invalid date with 400', async () => {
		const res = await app.request(
			guildUrl('/api/availability?date=2026-02-30'),
			{ method: 'DELETE', headers: { Cookie: guildCookie(cookie) } },
			testEnv(db),
		);
		expect(res.status).toBe(400);
		const json = await res.json();
		expect(json.error.code).toBe('BAD_REQUEST');
	});
});
