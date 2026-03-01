import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { createTestDb, TEST_GUILD_ID } from '../setup';

/** Secondary guild ID used to test multi-guild routing. */
const GUILD_2 = '99999999999999999';

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
	let guild1Db: D1Database;
	let guild2Db: D1Database;

	beforeEach(() => {
		guild1Db = createTestDb();
		guild2Db = createTestDb();
	});

	// ---------------------------------------------------------------
	// 1. Bot auth with X-Guild-Id resolves guild DB
	// ---------------------------------------------------------------
	it('bot auth with X-Guild-Id resolves guild DB', async () => {
		// Seed a user only in the guild-specific DB
		const { sessionId } = await seedUserSession(guild2Db, {
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
				BOT_API_KEY: 'testkey',
				[`DB_${TEST_GUILD_ID}`]: guild2Db,
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
		const { sessionId } = await seedUserSession(guild1Db, {
			discordId: '800800800800800800',
			username: 'Guild1User',
			sessionId: 'shared_session_abc',
		});
		await seedUserSession(guild2Db, {
			discordId: '800800800800800800',
			username: 'Guild2User',
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
				BOT_API_KEY: 'testkey',
				[`DB_${TEST_GUILD_ID}`]: guild2Db,
				[`DB_${GUILD_2}`]: guild1Db,
			} as any,
		);

		expect(res.status).toBe(200);
		const body = await res.json() as any;
		expect(body.ok).toBe(true);
		// Cookie-based resolution should pick up guild_id cookie and route to guild2Db
		expect(body.data.discord_username).toBe('Guild2User');
	});

	// ---------------------------------------------------------------
	// 3. guild_id cookie resolves guild DB
	// ---------------------------------------------------------------
	it('guild_id cookie resolves guild DB', async () => {
		const { sessionId } = await seedUserSession(guild2Db, {
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
				[`DB_${TEST_GUILD_ID}`]: guild2Db,
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
		const { sessionId } = await seedUserSession(guild2Db, {
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
				[`DB_${TEST_GUILD_ID}`]: guild2Db,
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
			{} as any,
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
				{} as any,
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
				{} as any,
			);

			expect(res.status).toBe(400);
			const body = await res.json() as any;
			expect(body.ok).toBe(false);
			expect(body.error.code).toBe('INVALID_GUILD');
		});
	});

	// ---------------------------------------------------------------
	// 7. Unknown guild ID (no binding) returns 404 UNKNOWN_GUILD
	// ---------------------------------------------------------------
	it('unknown guild ID without binding returns 404 UNKNOWN_GUILD', async () => {
		const UNKNOWN_GUILD = '55555555555555555';

		const res = await app.request(
			`/api/users/me?guild=${UNKNOWN_GUILD}`,
			{
				headers: {
					Cookie: 'session_id=whatever',
				},
			},
			{
				[`DB_${TEST_GUILD_ID}`]: guild2Db,
			} as any,
		);

		expect(res.status).toBe(404);
		const body = await res.json() as any;
		expect(body.ok).toBe(false);
		expect(body.error.code).toBe('UNKNOWN_GUILD');
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

	// ---------------------------------------------------------------
	// 9. Multi-guild auth: bot creates token, browser callback
	//    consumes it via ?guild= query param
	// ---------------------------------------------------------------
	it('auth token created by bot is consumable via browser callback with ?guild= param', async () => {
		const env = {
			BOT_API_KEY: 'testkey',
			[`DB_${GUILD_2}`]: guild1Db,
			[`DB_${TEST_GUILD_ID}`]: guild2Db,
		} as any;

		// Step 1: Bot creates auth token (routed to guild1Db via GUILD_2 binding)
		const tokenRes = await app.request(
			'/api/auth/token',
			{
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Bot-Token': 'testkey',
					'X-Guild-Id': GUILD_2,
				},
				body: JSON.stringify({
					discord_id: '600600600600600600',
					discord_username: 'MultiGuildUser',
				}),
			},
			env,
		);
		expect(tokenRes.status).toBe(201);
		const { data: tokenData } = await tokenRes.json() as any;
		expect(tokenData.token).toBeTruthy();

		// Step 2: Browser callback with ?guild= param (same guild, same DB)
		const callbackRes = await app.request(
			`/api/auth/callback/${tokenData.token}?guild=${GUILD_2}`,
			{},
			env,
		);
		// Should redirect (302), not return INVALID_TOKEN
		expect(callbackRes.status).toBe(302);
		const setCookieHeader = callbackRes.headers.get('set-cookie');
		expect(setCookieHeader).toContain('session_id=');
	});

	// ---------------------------------------------------------------
	// 10. Multi-guild: token created via one guild DB is NOT
	//     consumable via another guild DB (cross-guild isolation)
	// ---------------------------------------------------------------
	it('auth token created in one guild DB is not consumable via another guild DB', async () => {
		// Bot creates token routed to guild2Db (TEST_GUILD_ID)
		const tokenRes = await app.request(
			'/api/auth/token',
			{
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Bot-Token': 'testkey',
					'X-Guild-Id': TEST_GUILD_ID,
				},
				body: JSON.stringify({
					discord_id: '700700700700700700',
					discord_username: 'GuildSpecificUser',
				}),
			},
			{
				BOT_API_KEY: 'testkey',
				[`DB_${TEST_GUILD_ID}`]: guild2Db,
				[`DB_${GUILD_2}`]: guild1Db,
			} as any,
		);
		expect(tokenRes.status).toBe(201);
		const { data: tokenData } = await tokenRes.json() as any;

		// Try consuming the token via a different guild (guild1Db) -- should fail
		const callbackRes = await app.request(
			`/api/auth/callback/${tokenData.token}?guild=${GUILD_2}`,
			{},
			{
				BOT_API_KEY: 'testkey',
				[`DB_${TEST_GUILD_ID}`]: guild2Db,
				[`DB_${GUILD_2}`]: guild1Db,
			} as any,
		);
		// Should fail - token is in guild2Db, but callback looks in guild1Db
		expect(callbackRes.status).toBe(401);
	});

	// ---------------------------------------------------------------
	// 11. Sequential guild requests don't pollute env
	// ---------------------------------------------------------------
	it('sequential guild requests do not pollute env across requests', async () => {
		const { sessionId: g2Session } = await seedUserSession(guild2Db, {
			discordId: '222222222222222222',
			username: 'Guild2User',
		});
		const { sessionId: g1Session } = await seedUserSession(guild1Db, {
			discordId: '111111111111111111',
			username: 'Guild1User',
		});

		// Single shared env object simulates Workers isolate reuse
		const sharedEnv = {
			BOT_API_KEY: 'testkey',
			[`DB_${TEST_GUILD_ID}`]: guild2Db,
			[`DB_${GUILD_2}`]: guild1Db,
		};

		// Request 1: guild-specific DB (mutates c.env.DB to guild2Db)
		const res1 = await app.request('/api/users/me', {
			headers: {
				'X-Bot-Token': 'testkey',
				'X-Guild-Id': TEST_GUILD_ID,
				Cookie: `session_id=${g2Session}`,
			},
		}, sharedEnv as any);
		expect(res1.status).toBe(200);
		expect((await res1.json() as any).data.discord_username).toBe('Guild2User');

		// Request 2: different guild -- must NOT see guild 2's DB
		const res2 = await app.request('/api/users/me', {
			headers: {
				'X-Bot-Token': 'testkey',
				'X-Guild-Id': GUILD_2,
				Cookie: `session_id=${g1Session}`,
			},
		}, sharedEnv as any);
		expect(res2.status).toBe(200);
		expect((await res2.json() as any).data.discord_username).toBe('Guild1User');
	});

	// ---------------------------------------------------------------
	// 12. Full multi-guild auth flow (token create -> consume across guilds)
	// ---------------------------------------------------------------
	it('full multi-guild auth flow: guild1 -> guild2 -> guild1 login works', async () => {
		const sharedEnv = {
			BOT_API_KEY: 'testkey',
			[`DB_${GUILD_2}`]: guild1Db,
			[`DB_${TEST_GUILD_ID}`]: guild2Db,
		} as any;

		// Step 1: Bot creates token for guild 1
		const token1Res = await app.request('/api/auth/token', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'X-Bot-Token': 'testkey', 'X-Guild-Id': GUILD_2 },
			body: JSON.stringify({ discord_id: '111', discord_username: 'User1' }),
		}, sharedEnv);
		expect(token1Res.status).toBe(201);
		const token1 = (await token1Res.json() as any).data.token;

		// Step 2: Bot creates token for guild 2
		const token2Res = await app.request('/api/auth/token', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'X-Bot-Token': 'testkey', 'X-Guild-Id': TEST_GUILD_ID },
			body: JSON.stringify({ discord_id: '222', discord_username: 'User2' }),
		}, sharedEnv);
		expect(token2Res.status).toBe(201);
		const token2 = (await token2Res.json() as any).data.token;

		// Step 3: User 2 consumes token (guild 2) -- this would pollute env without fix
		const cb2 = await app.request(`/api/auth/callback/${token2}?guild=${TEST_GUILD_ID}`, {}, sharedEnv);
		expect(cb2.status).toBe(302);

		// Step 4: User 1 consumes token (guild 1) -- THIS was failing before env isolation fix
		const cb1 = await app.request(`/api/auth/callback/${token1}?guild=${GUILD_2}`, {}, sharedEnv);
		expect(cb1.status).toBe(302);
		expect(cb1.headers.get('set-cookie')).toContain('session_id=');
	});

	// ---------------------------------------------------------------
	// 13. Cross-guild data isolation for games
	// ---------------------------------------------------------------
	it('games created in one guild are not visible in another', async () => {
		const { sessionId: s1 } = await seedUserSession(guild1Db, {
			discordId: '100100100100100100',
			username: 'U1',
			sessionId: 'sess_g1',
		});
		const { sessionId: s2 } = await seedUserSession(guild2Db, {
			discordId: '200200200200200200',
			username: 'U2',
			sessionId: 'sess_g2',
		});
		const sharedEnv = { [`DB_${GUILD_2}`]: guild1Db, [`DB_${TEST_GUILD_ID}`]: guild2Db } as any;

		// Create a game in guild 1
		const createRes = await app.request('/api/games', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Cookie: `session_id=${s1}; guild_id=${GUILD_2}` },
			body: JSON.stringify({ name: 'Guild1Game' }),
		}, sharedEnv);
		expect(createRes.status).toBe(201);

		// List games in guild 2 -- should be empty
		const listRes = await app.request('/api/games', {
			headers: { Cookie: `session_id=${s2}; guild_id=${TEST_GUILD_ID}` },
		}, sharedEnv);
		expect(listRes.status).toBe(200);
		expect((await listRes.json() as any).data).toHaveLength(0);
	});
});
