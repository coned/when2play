import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import app from '../../src/index';
import { createTestDb, TEST_GUILD_ID } from '../setup';
import { createAuthenticatedUser, apiRequest, setSettingRaw } from '../helpers';
import { PENDING_MAX_AGE_MS } from '../../src/lib/pending';

const KEY = 'testkey';
const MAX = 1_400_000;

describe('POST /api/rally/tree/share image limits', () => {
	let db: D1Database;
	let alice: { cookie: string; userId: string };

	beforeEach(async () => {
		db = createTestDb();
		alice = await createAuthenticatedUser(db, '80000000000000001', 'alice');
		await setSettingRaw(db, 'gather_cooldown_seconds', 0);
	});

	const share = (image_data: unknown) => apiRequest(db, alice.cookie, 'POST', '/api/rally/tree/share', { image_data });
	const shareCount = async () => (await db.prepare('SELECT COUNT(*) AS n FROM rally_tree_shares').first<{ n: number }>())!.n;

	it('rejects an image over 1,400,000 characters with 413', async () => {
		const res = await share('A'.repeat(MAX + 4));
		expect(res.status).toBe(413);
		expect(res.body.ok).toBe(false);
		expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
		expect(res.body.error.message).toContain('too large');
		expect(await shareCount()).toBe(0);
	});

	it('accepts an image of exactly 1,400,000 characters', async () => {
		const res = await share('A'.repeat(MAX));
		expect(res.status).toBe(201);
	});

	it('rejects image_data that is not plain base64', async () => {
		for (const bad of ['data:image/png;base64,AAAA', 'AAA', '!!!!', 'AA AA', 42]) {
			const res = await share(bad);
			expect(res.status, String(bad)).toBe(400);
			expect(res.body.error.code).toBe('BAD_REQUEST');
		}
		expect(await shareCount()).toBe(0);
		expect((await share('iVBORw0KGgo=')).status).toBe(201);
	});
});

describe('Tree share images are dropped once the share is finished', () => {
	let db: D1Database;
	let env: Record<string, unknown>;
	let alice: { cookie: string; userId: string };

	beforeEach(async () => {
		db = createTestDb();
		env = { BOT_API_KEY: KEY, [`DB_${TEST_GUILD_ID}`]: db };
		alice = await createAuthenticatedUser(db, '80000000000000002', 'alice');
		await setSettingRaw(db, 'gather_cooldown_seconds', 0);
	});

	async function newShare(): Promise<string> {
		const res = await apiRequest(db, alice.cookie, 'POST', '/api/rally/tree/share', { image_data: 'AAAA' });
		expect(res.status).toBe(201);
		return res.body.data.id;
	}

	async function row(id: string) {
		return (await db.prepare('SELECT delivered, image_data FROM rally_tree_shares WHERE id = ?').bind(id).first<{ delivered: number; image_data: string | null }>())!;
	}

	async function poll(acks?: Record<string, string[]>) {
		const res = await app.request('/api/bot/poll', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'X-Bot-Token': KEY },
			body: JSON.stringify({ guild_ids: [TEST_GUILD_ID], ...(acks ? { acks: { [TEST_GUILD_ID]: acks } } : {}) }),
		}, env as any);
		expect(res.status).toBe(200);
		return (await res.json()) as any;
	}

	it('an aggregated poll ack nulls image_data', async () => {
		const id = await newShare();
		const first = await poll();
		expect(first.data.guilds[TEST_GUILD_ID].tree_shares[0].image_data).toBe('AAAA');
		await poll({ tree_shares: [id] });
		expect(await row(id)).toEqual({ delivered: 1, image_data: null });
	});

	it('the legacy delivered PATCH nulls image_data', async () => {
		const id = await newShare();
		const res = await app.request(`/api/rally/tree/share/${id}/delivered`, {
			method: 'PATCH',
			headers: { 'X-Bot-Token': KEY, 'X-Guild-Id': TEST_GUILD_ID },
		}, env as any);
		expect(res.status).toBe(200);
		expect(await row(id)).toEqual({ delivered: 1, image_data: null });
	});

	it('expiry nulls image_data and sets delivered = 2', async () => {
		const stale = await newShare();
		const fresh = await newShare();
		await db.prepare('UPDATE rally_tree_shares SET created_at = ? WHERE id = ?').bind(new Date(Date.now() - PENDING_MAX_AGE_MS - 60_000).toISOString(), stale).run();
		const res = await poll();
		expect(res.data.guilds[TEST_GUILD_ID].tree_shares.map((s: any) => s.id)).toEqual([fresh]);
		expect(await row(stale)).toEqual({ delivered: 2, image_data: null });
		expect(await row(fresh)).toEqual({ delivered: 0, image_data: 'AAAA' });
	});
});

describe('migration 0009_clear_delivered_tree_images', () => {
	it('nulls image_data on finished rows only', async () => {
		const db = createTestDb();
		const alice = await createAuthenticatedUser(db, '80000000000000003', 'alice');
		for (const [id, delivered] of [['p', 0], ['d', 1], ['e', 2]] as const) {
			await db
				.prepare("INSERT INTO rally_tree_shares (id, requested_by, day_key, image_data, delivered, created_at) VALUES (?, ?, '2026-01-01', 'AAAA', ?, '2026-01-01T00:00:00.000Z')")
				.bind(id, alice.userId, delivered)
				.run();
		}
		const sql = fs.readFileSync(path.join(__dirname, '..', '..', 'migrations', '0009_clear_delivered_tree_images.sql'), 'utf-8');
		await db.exec(sql);
		const { results } = await db.prepare('SELECT id, image_data FROM rally_tree_shares ORDER BY id').all<{ id: string; image_data: string | null }>();
		expect(results).toEqual([
			{ id: 'd', image_data: null },
			{ id: 'e', image_data: null },
			{ id: 'p', image_data: 'AAAA' },
		]);
	});
});
