import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { createTestDb, guildUrl, guildCookie } from '../setup';

async function createAuthenticatedUser(db: D1Database, discordId: string = '123456', username: string = 'TestUser') {
	const tokenRes = await app.request(
		guildUrl('/api/auth/token'),
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ discord_id: discordId, discord_username: username }),
		},
		{ DB: db },
	);
	const { data } = await tokenRes.json();
	const callbackRes = await app.request(guildUrl(`/api/auth/callback/${data.token}`), {}, { DB: db });
	const cookie = callbackRes.headers.get('set-cookie')!;
	const sessionId = cookie.match(/session_id=([^;]+)/)![1];
	return `session_id=${sessionId}`;
}

describe('Game routes', () => {
	let db: D1Database;
	let cookie: string;

	beforeEach(async () => {
		db = createTestDb();
		cookie = await createAuthenticatedUser(db);
	});

	it('creates and lists games', async () => {
		// Create
		const createRes = await app.request(
			guildUrl('/api/games'),
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Cookie: guildCookie(cookie) },
				body: JSON.stringify({ name: 'Counter-Strike 2', steam_app_id: '730' }),
			},
			{ DB: db },
		);

		expect(createRes.status).toBe(201);
		const created = await createRes.json();
		expect(created.data.name).toBe('Counter-Strike 2');
		expect(created.data.is_archived).toBe(false);

		// List
		const listRes = await app.request(guildUrl('/api/games'), { headers: { Cookie: guildCookie(cookie) } }, { DB: db });
		expect(listRes.status).toBe(200);
		const listed = await listRes.json();
		expect(listed.data).toHaveLength(1);
	});

	it('archives a game', async () => {
		const createRes = await app.request(
			guildUrl('/api/games'),
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Cookie: guildCookie(cookie) },
				body: JSON.stringify({ name: 'Test Game' }),
			},
			{ DB: db },
		);
		const { data: game } = await createRes.json();

		// Archive
		const deleteRes = await app.request(guildUrl(`/api/games/${game.id}`), { method: 'DELETE', headers: { Cookie: guildCookie(cookie) } }, { DB: db });
		expect(deleteRes.status).toBe(200);

		// Not in active list
		const listRes = await app.request(guildUrl('/api/games'), { headers: { Cookie: guildCookie(cookie) } }, { DB: db });
		const listed = await listRes.json();
		expect(listed.data).toHaveLength(0);

		// In archived list
		const archivedRes = await app.request(guildUrl('/api/games?include_archived=true'), { headers: { Cookie: guildCookie(cookie) } }, { DB: db });
		const archived = await archivedRes.json();
		expect(archived.data).toHaveLength(1);
		expect(archived.data[0].is_archived).toBe(true);
	});

	it('prevents non-owner from updating', async () => {
		const createRes = await app.request(
			guildUrl('/api/games'),
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Cookie: guildCookie(cookie) },
				body: JSON.stringify({ name: 'Test Game' }),
			},
			{ DB: db },
		);
		const { data: game } = await createRes.json();

		// Another user
		const otherCookie = await createAuthenticatedUser(db, '999999', 'OtherUser');
		const updateRes = await app.request(
			guildUrl(`/api/games/${game.id}`),
			{
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json', Cookie: guildCookie(otherCookie) },
				body: JSON.stringify({ name: 'Hacked Name' }),
			},
			{ DB: db },
		);
		expect(updateRes.status).toBe(403);
	});
});
