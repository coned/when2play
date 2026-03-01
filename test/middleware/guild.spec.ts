import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { createTestDb, TEST_GUILD_ID } from '../setup';

/**
 * Seed a user and session directly into a D1-compatible database.
 * Returns the session_id string for use in Cookie headers.
 */
async function seedUserSession(
	db: D1Database,
	opts: { discordId?: string; username?: string; sessionId?: string } = {},
): Promise<{ sessionId: string; userId: string }> {
	const discordId = opts.discordId ?? '111222333444555666';
	const username = opts.username ?? 'GuildTestUser';
	const sessionId = opts.sessionId ?? `sess_${Math.random().toString(36).slice(2)}`;
	const userId = `user_${discordId}`;
	const now = new Date().toISOString();
	const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

	await db.prepare(
		`INSERT INTO users (id, discord_id, discord_username, timezone, time_granularity_minutes, created_at, updated_at)
		 VALUES (?, ?, ?, 'UTC', 15, ?, ?)`,
	).bind(userId, discordId, username, now, now).run();

	await db.prepare(
		`INSERT INTO sessions (id, session_id, user_id, expires_at, is_admin, created_at)
		 VALUES (?, ?, ?, ?, 0, ?)`,
	).bind(`sid_${sessionId}`, sessionId, userId, expires, now).run();

	return { sessionId, userId };
}

describe('Guild DB routing middleware', () => {
	let defaultDb: D1Database;
	let guildDb: D1Database;

	beforeEach(() => {
		defaultDb = createTestDb();
		guildDb = createTestDb();
	});

	// ---------------------------------------------------------------
	// 1. Bot auth with X-Guild-Id resolves guild DB
	// ---------------------------------------------------------------
	it('bot auth with X-Guild-Id resolves guild DB', async () => {
		// Seed a user only in the guild-specific DB
		const { sessionId } = await seedUserSession(guildDb, {
			discordId: '900900900900900900',
			username: 'GuildOnlyUser',
		});

		const res = await app.request(
			'/api/users/me',
			{
				headers: {
					'X-Bot-Token': 'testkey',
					'X-Guild-Id': TEST_GUILD_ID,
					Cookie: `session_id=${sessionId}`,
				},
			},
			{
				DB: defaultDb,
				BOT_API_KEY: 'testkey',
				[`DB_${TEST_GUILD_ID}`]: guildDb,
			} as any,
		);

		expect(res.status).toBe(200);
		const body = await res.json() as any;
		expect(body.ok).toBe(true);
		expect(body.data.discord_username).toBe('GuildOnlyUser');
	});

	// ---------------------------------------------------------------
	// 2. Bot auth without matching token ignores X-Guild-Id header
	// ---------------------------------------------------------------
	it('bot auth without matching token falls back to cookie', async () => {
		// Seed a user in both DBs with different usernames
		const { sessionId } = await seedUserSession(defaultDb, {
			discordId: '800800800800800800',
			username: 'DefaultDbUser',
			sessionId: 'shared_session_abc',
		});
		await seedUserSession(guildDb, {
			discordId: '800800800800800800',
			username: 'GuildDbUser',
			sessionId: 'shared_session_abc',
		});

		// Wrong bot token, but guild_id cookie present -- should fall back to cookie
		const res = await app.request(
			'/api/users/me',
			{
				headers: {
					'X-Bot-Token': 'wrong',
					'X-Guild-Id': TEST_GUILD_ID,
					Cookie: `session_id=${sessionId}; guild_id=${TEST_GUILD_ID}`,
				},
			},
			{
				DB: defaultDb,
				BOT_API_KEY: 'testkey',
				[`DB_${TEST_GUILD_ID}`]: guildDb,
			} as any,
		);

		expect(res.status).toBe(200);
		const body = await res.json() as any;
		expect(body.ok).toBe(true);
		// Cookie-based resolution should pick up guild_id cookie and route to guildDb
		expect(body.data.discord_username).toBe('GuildDbUser');
	});

	// ---------------------------------------------------------------
	// 3. guild_id cookie resolves guild DB
	// ---------------------------------------------------------------
	it('guild_id cookie resolves guild DB', async () => {
		const { sessionId } = await seedUserSession(guildDb, {
			discordId: '700700700700700700',
			username: 'CookieGuildUser',
		});

		const res = await app.request(
			'/api/users/me',
			{
				headers: {
					Cookie: `session_id=${sessionId}; guild_id=${TEST_GUILD_ID}`,
				},
			},
			{
				DB: defaultDb,
				[`DB_${TEST_GUILD_ID}`]: guildDb,
			} as any,
		);

		expect(res.status).toBe(200);
		const body = await res.json() as any;
		expect(body.ok).toBe(true);
		expect(body.data.discord_username).toBe('CookieGuildUser');
	});

	// ---------------------------------------------------------------
	// 4. guild query param resolves guild DB
	// ---------------------------------------------------------------
	it('guild query param resolves guild DB', async () => {
		const { sessionId } = await seedUserSession(guildDb, {
			discordId: '600600600600600600',
			username: 'QueryParamUser',
		});

		const res = await app.request(
			`/api/users/me?guild=${TEST_GUILD_ID}`,
			{
				headers: {
					Cookie: `session_id=${sessionId}`,
				},
			},
			{
				DB: defaultDb,
				[`DB_${TEST_GUILD_ID}`]: guildDb,
			} as any,
		);

		expect(res.status).toBe(200);
		const body = await res.json() as any;
		expect(body.ok).toBe(true);
		expect(body.data.discord_username).toBe('QueryParamUser');
	});

	// ---------------------------------------------------------------
	// 5. No guild context returns 400 MISSING_GUILD
	// ---------------------------------------------------------------
	it('returns 400 MISSING_GUILD when no guild context provided', async () => {
		const res = await app.request(
			'/api/users/me',
			{},
			{ DB: defaultDb } as any,
		);

		expect(res.status).toBe(400);
		const body = await res.json() as any;
		expect(body.ok).toBe(false);
		expect(body.error.code).toBe('MISSING_GUILD');
	});

	// ---------------------------------------------------------------
	// 6. Invalid guild ID format returns 400 INVALID_GUILD
	// ---------------------------------------------------------------
	describe('invalid guild ID format returns 400 INVALID_GUILD', () => {
		it('rejects alphabetic guild ID', async () => {
			const res = await app.request(
				'/api/users/me?guild=abc',
				{},
				{ DB: defaultDb } as any,
			);

			expect(res.status).toBe(400);
			const body = await res.json() as any;
			expect(body.ok).toBe(false);
			expect(body.error.code).toBe('INVALID_GUILD');
		});

		it('rejects too-short numeric guild ID', async () => {
			const res = await app.request(
				'/api/users/me?guild=123',
				{},
				{ DB: defaultDb } as any,
			);

			expect(res.status).toBe(400);
			const body = await res.json() as any;
			expect(body.ok).toBe(false);
			expect(body.error.code).toBe('INVALID_GUILD');
		});
	});

	// ---------------------------------------------------------------
	// 7. Unknown guild ID falls back to default DB
	// ---------------------------------------------------------------
	it('unknown guild ID falls back to default DB when DB binding exists', async () => {
		// Seed a user only in defaultDb
		const { sessionId } = await seedUserSession(defaultDb, {
			discordId: '500500500500500500',
			username: 'FallbackUser',
		});

		// No DB_<guildId> binding -- only the default DB
		const res = await app.request(
			`/api/users/me?guild=${TEST_GUILD_ID}`,
			{
				headers: {
					Cookie: `session_id=${sessionId}`,
				},
			},
			{ DB: defaultDb } as any,
		);

		expect(res.status).toBe(200);
		const body = await res.json() as any;
		expect(body.ok).toBe(true);
		expect(body.data.discord_username).toBe('FallbackUser');
	});

	// ---------------------------------------------------------------
	// 8. Health endpoint works without guild context
	// ---------------------------------------------------------------
	it('health endpoint works without guild context', async () => {
		const res = await app.request('/api/health');

		expect(res.status).toBe(200);
		const body = await res.json() as any;
		expect(body.ok).toBe(true);
		expect(body.data.status).toBe('healthy');
	});
});
