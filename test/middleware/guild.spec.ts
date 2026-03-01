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

	// ---------------------------------------------------------------
	// 9. Multi-guild auth: bot creates token, browser callback consumes
	//    it via ?guild= query param falling back to default DB
	// ---------------------------------------------------------------
	it('auth token created by bot (default DB) is consumable via browser callback with ?guild= param', async () => {
		const UNKNOWN_GUILD = '99999999999999999'; // no DB_<id> binding
		const env = {
			DB: defaultDb,
			BOT_API_KEY: 'testkey',
			[`DB_${TEST_GUILD_ID}`]: guildDb,
		} as any;

		// Step 1: Bot creates auth token (routed to default DB via fallback)
		const tokenRes = await app.request(
			'/api/auth/token',
			{
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Bot-Token': 'testkey',
					'X-Guild-Id': UNKNOWN_GUILD,
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

		// Step 2: Browser callback with ?guild= param (same unknown guild, fallback to default DB)
		const callbackRes = await app.request(
			`/api/auth/callback/${tokenData.token}?guild=${UNKNOWN_GUILD}`,
			{},
			env,
		);
		// Should redirect (302), not return INVALID_TOKEN
		expect(callbackRes.status).toBe(302);
		const setCookieHeader = callbackRes.headers.get('set-cookie');
		expect(setCookieHeader).toContain('session_id=');
	});

	// ---------------------------------------------------------------
	// 10. Multi-guild: token created via guild-specific DB is NOT
	//     consumable via fallback default DB (cross-guild isolation)
	// ---------------------------------------------------------------
	it('auth token created in guild-specific DB is not consumable via default DB', async () => {
		const UNKNOWN_GUILD = '99999999999999999';

		// Bot creates token routed to guild-specific DB
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
				DB: defaultDb,
				BOT_API_KEY: 'testkey',
				[`DB_${TEST_GUILD_ID}`]: guildDb,
			} as any,
		);
		expect(tokenRes.status).toBe(201);
		const { data: tokenData } = await tokenRes.json() as any;

		// Use a FRESH env to simulate a separate production request
		// (env is per-request in Cloudflare Workers)
		const callbackRes = await app.request(
			`/api/auth/callback/${tokenData.token}?guild=${UNKNOWN_GUILD}`,
			{},
			{
				DB: defaultDb,
				BOT_API_KEY: 'testkey',
				[`DB_${TEST_GUILD_ID}`]: guildDb,
			} as any,
		);
		// Should fail - token is in guildDb, but callback looks in defaultDb
		expect(callbackRes.status).toBe(401);
	});

	// ---------------------------------------------------------------
	// 11. Sequential guild requests don't pollute env
	// ---------------------------------------------------------------
	it('sequential guild requests do not pollute env across requests', async () => {
		const { sessionId: g2Session } = await seedUserSession(guildDb, {
			discordId: '222222222222222222',
			username: 'Guild2User',
		});
		const { sessionId: g1Session } = await seedUserSession(defaultDb, {
			discordId: '111111111111111111',
			username: 'Guild1User',
		});

		// Single shared env object simulates Workers isolate reuse
		const sharedEnv = {
			DB: defaultDb,
			BOT_API_KEY: 'testkey',
			[`DB_${TEST_GUILD_ID}`]: guildDb,
		};

		// Request 1: guild-specific DB (mutates c.env.DB to guildDb)
		const res1 = await app.request('/api/users/me', {
			headers: {
				'X-Bot-Token': 'testkey',
				'X-Guild-Id': TEST_GUILD_ID,
				Cookie: `session_id=${g2Session}`,
			},
		}, sharedEnv as any);
		expect(res1.status).toBe(200);
		expect((await res1.json() as any).data.discord_username).toBe('Guild2User');

		// Request 2: fallback to default DB -- must NOT see guild 2's DB
		const GUILD_1 = '99999999999999999'; // no binding, falls back to default
		const res2 = await app.request('/api/users/me', {
			headers: {
				'X-Bot-Token': 'testkey',
				'X-Guild-Id': GUILD_1,
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
		const GUILD_1 = '99999999999999999'; // falls back to default DB
		const sharedEnv = {
			DB: defaultDb,
			BOT_API_KEY: 'testkey',
			[`DB_${TEST_GUILD_ID}`]: guildDb,
		} as any;

		// Step 1: Bot creates token for guild 1 (default DB)
		const token1Res = await app.request('/api/auth/token', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', 'X-Bot-Token': 'testkey', 'X-Guild-Id': GUILD_1 },
			body: JSON.stringify({ discord_id: '111', discord_username: 'User1' }),
		}, sharedEnv);
		expect(token1Res.status).toBe(201);
		const token1 = (await token1Res.json() as any).data.token;

		// Step 2: Bot creates token for guild 2 (guild-specific DB)
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

		// Step 4: User 1 consumes token (guild 1, default DB) -- THIS was failing before
		const cb1 = await app.request(`/api/auth/callback/${token1}?guild=${GUILD_1}`, {}, sharedEnv);
		expect(cb1.status).toBe(302);
		expect(cb1.headers.get('set-cookie')).toContain('session_id=');
	});

	// ---------------------------------------------------------------
	// 13. Cross-guild data isolation for games
	// ---------------------------------------------------------------
	it('games created in one guild are not visible in another', async () => {
		const { sessionId: s1 } = await seedUserSession(defaultDb, {
			discordId: '100100100100100100',
			username: 'U1',
			sessionId: 'sess_g1',
		});
		const { sessionId: s2 } = await seedUserSession(guildDb, {
			discordId: '200200200200200200',
			username: 'U2',
			sessionId: 'sess_g2',
		});
		const sharedEnv = { DB: defaultDb, [`DB_${TEST_GUILD_ID}`]: guildDb } as any;
		const GUILD_1 = '99999999999999999';

		// Create a game in guild 1 (default DB)
		const createRes = await app.request('/api/games', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Cookie: `session_id=${s1}; guild_id=${GUILD_1}` },
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
