import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../setup';
import { upsertUser } from '../../src/db/queries/users';
import { createAuthToken, consumeAuthToken } from '../../src/db/queries/auth';
import { createOrGetRally } from '../../src/db/queries/rally';

describe('consumeAuthToken', () => {
	let db: D1Database;
	let userId: string;

	beforeEach(async () => {
		db = createTestDb();
		userId = (await upsertUser(db, '3001', 'dave')).id;
	});

	it('lets exactly one of two concurrent consumers use a token', async () => {
		await createAuthToken(db, userId, 'tok-concurrent');
		const results = await Promise.all([consumeAuthToken(db, 'tok-concurrent'), consumeAuthToken(db, 'tok-concurrent')]);
		expect(results.filter((r) => r !== null)).toHaveLength(1);
		expect(results.find((r) => r !== null)!.user_id).toBe(userId);
		expect(await consumeAuthToken(db, 'tok-concurrent')).toBeNull();
	});

	it('refuses an expired token', async () => {
		await createAuthToken(db, userId, 'tok-expired');
		await db.prepare('UPDATE auth_tokens SET expires_at = ? WHERE token = ?').bind(new Date(Date.now() - 1000).toISOString(), 'tok-expired').run();
		expect(await consumeAuthToken(db, 'tok-expired')).toBeNull();
	});

	it('refuses an unknown token', async () => {
		expect(await consumeAuthToken(db, 'nope')).toBeNull();
	});
});

describe('createOrGetRally', () => {
	it('returns the same rally to two concurrent first calls of a day', async () => {
		const db = createTestDb();
		const a = await upsertUser(db, '4001', 'erin');
		const b = await upsertUser(db, '4002', 'frank');
		const [r1, r2] = await Promise.all([createOrGetRally(db, a.id, 'now', '2026-10-03'), createOrGetRally(db, b.id, 'now', '2026-10-03')]);
		expect(r1.id).toBe(r2.id);
		const count = await db.prepare('SELECT COUNT(*) AS n FROM rallies WHERE day_key = ?').bind('2026-10-03').first<number>('n');
		expect(count).toBe(1);
		// A later call keeps the first creator
		const again = await createOrGetRally(db, b.id, 'later', '2026-10-03');
		expect(again).toEqual(r1);
	});
});
