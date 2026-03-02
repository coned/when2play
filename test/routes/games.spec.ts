import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { createTestDb, guildUrl, guildCookie, testEnv } from '../setup';

async function createAuthenticatedUser(db: D1Database, discordId: string = '123456', username: string = 'TestUser') {
	const tokenRes = await app.request(
		guildUrl('/api/auth/token'),
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ discord_id: discordId, discord_username: username }),
		},
		testEnv(db),
	);
	const { data } = await tokenRes.json();
	const callbackRes = await app.request(guildUrl(`/api/auth/callback/${data.token}`), {}, testEnv(db));
	const cookie = callbackRes.headers.get('set-cookie')!;
	const sessionId = cookie.match(/session_id=([^;]+)/)![1];
	return `session_id=${sessionId}`;
}

async function createGame(db: D1Database, cookie: string, body: { name: string; steam_app_id?: string; image_url?: string }) {
	const res = await app.request(
		guildUrl('/api/games'),
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Cookie: guildCookie(cookie) },
			body: JSON.stringify(body),
		},
		testEnv(db),
	);
	return res;
}

describe('Game routes', () => {
	let db: D1Database;
	let cookie: string;

	beforeEach(async () => {
		db = createTestDb();
		cookie = await createAuthenticatedUser(db);
	});

	it('creates and lists games', async () => {
		const createRes = await createGame(db, cookie, { name: 'Counter-Strike 2', steam_app_id: '730' });
		expect(createRes.status).toBe(201);
		const created = await createRes.json();
		expect(created.data.name).toBe('Counter-Strike 2');
		expect(created.data.is_archived).toBe(false);

		const listRes = await app.request(guildUrl('/api/games'), { headers: { Cookie: guildCookie(cookie) } }, testEnv(db));
		expect(listRes.status).toBe(200);
		const listed = await listRes.json();
		expect(listed.data).toHaveLength(1);
		expect(listed.data[0].like_count).toBe(0);
		expect(listed.data[0].dislike_count).toBe(0);
		expect(listed.data[0].user_reaction).toBe(null);
		expect(listed.data[0].reaction_users).toHaveLength(0);
	});

	it('archives a game', async () => {
		const createRes = await createGame(db, cookie, { name: 'Test Game' });
		const { data: game } = await createRes.json();

		const deleteRes = await app.request(guildUrl(`/api/games/${game.id}`), { method: 'DELETE', headers: { Cookie: guildCookie(cookie) } }, testEnv(db));
		expect(deleteRes.status).toBe(200);

		const listRes = await app.request(guildUrl('/api/games'), { headers: { Cookie: guildCookie(cookie) } }, testEnv(db));
		const listed = await listRes.json();
		expect(listed.data).toHaveLength(0);

		const archivedRes = await app.request(guildUrl('/api/games?include_archived=true'), { headers: { Cookie: guildCookie(cookie) } }, testEnv(db));
		const archived = await archivedRes.json();
		expect(archived.data).toHaveLength(1);
		expect(archived.data[0].is_archived).toBe(true);
	});

	it('prevents non-owner from updating', async () => {
		const createRes = await createGame(db, cookie, { name: 'Test Game' });
		const { data: game } = await createRes.json();

		const otherCookie = await createAuthenticatedUser(db, '999999', 'OtherUser');
		const updateRes = await app.request(
			guildUrl(`/api/games/${game.id}`),
			{
				method: 'PATCH',
				headers: { 'Content-Type': 'application/json', Cookie: guildCookie(otherCookie) },
				body: JSON.stringify({ name: 'Hacked Name' }),
			},
			testEnv(db),
		);
		expect(updateRes.status).toBe(403);
	});

	// --- Reactions (like/dislike) ---

	it('likes and unlikes a game via react endpoint', async () => {
		const createRes = await createGame(db, cookie, { name: 'Likeable Game' });
		const { data: game } = await createRes.json();

		// Like
		const likeRes = await app.request(
			guildUrl(`/api/games/${game.id}/react`),
			{ method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: guildCookie(cookie) }, body: JSON.stringify({ type: 'like' }) },
			testEnv(db),
		);
		expect(likeRes.status).toBe(200);

		const listRes = await app.request(guildUrl('/api/games'), { headers: { Cookie: guildCookie(cookie) } }, testEnv(db));
		const listed = await listRes.json();
		expect(listed.data[0].like_count).toBe(1);
		expect(listed.data[0].dislike_count).toBe(0);
		expect(listed.data[0].user_reaction).toBe('like');

		// Remove reaction
		const removeRes = await app.request(
			guildUrl(`/api/games/${game.id}/react`),
			{ method: 'DELETE', headers: { Cookie: guildCookie(cookie) } },
			testEnv(db),
		);
		expect(removeRes.status).toBe(200);

		const listRes2 = await app.request(guildUrl('/api/games'), { headers: { Cookie: guildCookie(cookie) } }, testEnv(db));
		const listed2 = await listRes2.json();
		expect(listed2.data[0].like_count).toBe(0);
		expect(listed2.data[0].user_reaction).toBe(null);
	});

	it('dislikes a game', async () => {
		const createRes = await createGame(db, cookie, { name: 'Dislikeable Game' });
		const { data: game } = await createRes.json();

		await app.request(
			guildUrl(`/api/games/${game.id}/react`),
			{ method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: guildCookie(cookie) }, body: JSON.stringify({ type: 'dislike' }) },
			testEnv(db),
		);

		const listRes = await app.request(guildUrl('/api/games'), { headers: { Cookie: guildCookie(cookie) } }, testEnv(db));
		const listed = await listRes.json();
		expect(listed.data[0].like_count).toBe(0);
		expect(listed.data[0].dislike_count).toBe(1);
		expect(listed.data[0].user_reaction).toBe('dislike');
	});

	it('switching from like to dislike replaces reaction', async () => {
		const createRes = await createGame(db, cookie, { name: 'Switchy Game' });
		const { data: game } = await createRes.json();

		// Like first
		await app.request(
			guildUrl(`/api/games/${game.id}/react`),
			{ method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: guildCookie(cookie) }, body: JSON.stringify({ type: 'like' }) },
			testEnv(db),
		);

		// Switch to dislike
		await app.request(
			guildUrl(`/api/games/${game.id}/react`),
			{ method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: guildCookie(cookie) }, body: JSON.stringify({ type: 'dislike' }) },
			testEnv(db),
		);

		const listRes = await app.request(guildUrl('/api/games'), { headers: { Cookie: guildCookie(cookie) } }, testEnv(db));
		const listed = await listRes.json();
		expect(listed.data[0].like_count).toBe(0);
		expect(listed.data[0].dislike_count).toBe(1);
		expect(listed.data[0].user_reaction).toBe('dislike');
	});

	it('reaction is idempotent', async () => {
		const createRes = await createGame(db, cookie, { name: 'Idem Game' });
		const { data: game } = await createRes.json();

		await app.request(
			guildUrl(`/api/games/${game.id}/react`),
			{ method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: guildCookie(cookie) }, body: JSON.stringify({ type: 'like' }) },
			testEnv(db),
		);
		await app.request(
			guildUrl(`/api/games/${game.id}/react`),
			{ method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: guildCookie(cookie) }, body: JSON.stringify({ type: 'like' }) },
			testEnv(db),
		);

		const listRes = await app.request(guildUrl('/api/games'), { headers: { Cookie: guildCookie(cookie) } }, testEnv(db));
		const listed = await listRes.json();
		expect(listed.data[0].like_count).toBe(1);
	});

	it('multiple users can react', async () => {
		const createRes = await createGame(db, cookie, { name: 'Popular Game' });
		const { data: game } = await createRes.json();

		const otherCookie = await createAuthenticatedUser(db, '999999', 'OtherUser');

		await app.request(
			guildUrl(`/api/games/${game.id}/react`),
			{ method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: guildCookie(cookie) }, body: JSON.stringify({ type: 'like' }) },
			testEnv(db),
		);
		await app.request(
			guildUrl(`/api/games/${game.id}/react`),
			{ method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: guildCookie(otherCookie) }, body: JSON.stringify({ type: 'dislike' }) },
			testEnv(db),
		);

		const listRes = await app.request(guildUrl('/api/games'), { headers: { Cookie: guildCookie(cookie) } }, testEnv(db));
		const listed = await listRes.json();
		expect(listed.data[0].like_count).toBe(1);
		expect(listed.data[0].dislike_count).toBe(1);
		expect(listed.data[0].reaction_users).toHaveLength(2);
	});

	it('returns reaction users with avatar info', async () => {
		const createRes = await createGame(db, cookie, { name: 'Avatar Game' });
		const { data: game } = await createRes.json();

		await app.request(
			guildUrl(`/api/games/${game.id}/react`),
			{ method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: guildCookie(cookie) }, body: JSON.stringify({ type: 'like' }) },
			testEnv(db),
		);

		const listRes = await app.request(guildUrl('/api/games'), { headers: { Cookie: guildCookie(cookie) } }, testEnv(db));
		const listed = await listRes.json();
		const users = listed.data[0].reaction_users;
		expect(users).toHaveLength(1);
		expect(users[0].type).toBe('like');
		expect(users[0].user_id).toBeDefined();
	});

	// --- Duplicate detection ---

	it('rejects duplicate steam game', async () => {
		await createGame(db, cookie, { name: 'Counter-Strike 2', steam_app_id: '730' });

		const dupRes = await createGame(db, cookie, { name: 'CS2 Again', steam_app_id: '730' });
		expect(dupRes.status).toBe(409);
		const dup = await dupRes.json();
		expect(dup.error.code).toBe('DUPLICATE_GAME');
		expect(dup.error.existing_game_id).toBeDefined();
	});

	it('detects archived duplicate', async () => {
		const createRes = await createGame(db, cookie, { name: 'CS2', steam_app_id: '730' });
		const { data: game } = await createRes.json();

		await app.request(guildUrl(`/api/games/${game.id}`), { method: 'DELETE', headers: { Cookie: guildCookie(cookie) } }, testEnv(db));

		const dupRes = await createGame(db, cookie, { name: 'CS2 Again', steam_app_id: '730' });
		expect(dupRes.status).toBe(409);
		const dup = await dupRes.json();
		expect(dup.error.code).toBe('ARCHIVED_DUPLICATE');
		expect(dup.error.existing_game_id).toBe(game.id);
	});

	it('allows duplicate non-steam games', async () => {
		const res1 = await createGame(db, cookie, { name: 'Custom Game' });
		expect(res1.status).toBe(201);

		const res2 = await createGame(db, cookie, { name: 'Custom Game' });
		expect(res2.status).toBe(201);
	});

	// --- Archive by any user with reason ---

	it('any user can archive a game', async () => {
		const createRes = await createGame(db, cookie, { name: 'Archivable Game' });
		const { data: game } = await createRes.json();

		const otherCookie = await createAuthenticatedUser(db, '999999', 'OtherUser');
		const archiveRes = await app.request(
			guildUrl(`/api/games/${game.id}`),
			{
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json', Cookie: guildCookie(otherCookie) },
				body: JSON.stringify({ reason: 'not_interested' }),
			},
			testEnv(db),
		);
		expect(archiveRes.status).toBe(200);
	});

	it('archive stores reason on the game', async () => {
		const createRes = await createGame(db, cookie, { name: 'Reason Game' });
		const { data: game } = await createRes.json();

		await app.request(
			guildUrl(`/api/games/${game.id}`),
			{
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json', Cookie: guildCookie(cookie) },
				body: JSON.stringify({ reason: 'save_for_later' }),
			},
			testEnv(db),
		);

		// Check the archived game has the reason
		const archivedRes = await app.request(guildUrl('/api/games?pool=archive'), { headers: { Cookie: guildCookie(cookie) } }, testEnv(db));
		const archived = await archivedRes.json();
		expect(archived.data[0].archive_reason).toBe('save_for_later');
		expect(archived.data[0].archived_at).toBeDefined();
	});

	it('archive with reason is recorded in activity', async () => {
		const createRes = await createGame(db, cookie, { name: 'Activity Reason Game' });
		const { data: game } = await createRes.json();

		await app.request(
			guildUrl(`/api/games/${game.id}`),
			{
				method: 'DELETE',
				headers: { 'Content-Type': 'application/json', Cookie: guildCookie(cookie) },
				body: JSON.stringify({ reason: 'save_for_later' }),
			},
			testEnv(db),
		);

		const activityRes = await app.request(guildUrl('/api/games/activity'), { headers: { Cookie: guildCookie(cookie) } }, testEnv(db));
		const activity = await activityRes.json();
		const archiveEntry = activity.data.find((a: any) => a.action === 'archive');
		expect(archiveEntry).toBeDefined();
		expect(archiveEntry.detail).toContain('save_for_later');
	});

	// --- Restore ---

	it('restores an archived game', async () => {
		const createRes = await createGame(db, cookie, { name: 'Restorable Game' });
		const { data: game } = await createRes.json();

		await app.request(guildUrl(`/api/games/${game.id}`), { method: 'DELETE', headers: { Cookie: guildCookie(cookie) } }, testEnv(db));

		const restoreRes = await app.request(
			guildUrl(`/api/games/${game.id}/restore`),
			{ method: 'POST', headers: { Cookie: guildCookie(cookie) } },
			testEnv(db),
		);
		expect(restoreRes.status).toBe(200);

		const listRes = await app.request(guildUrl('/api/games'), { headers: { Cookie: guildCookie(cookie) } }, testEnv(db));
		const listed = await listRes.json();
		expect(listed.data).toHaveLength(1);
		expect(listed.data[0].name).toBe('Restorable Game');
		expect(listed.data[0].archive_reason).toBe(null);
	});

	it('restore on non-archived game returns error', async () => {
		const createRes = await createGame(db, cookie, { name: 'Active Game' });
		const { data: game } = await createRes.json();

		const restoreRes = await app.request(
			guildUrl(`/api/games/${game.id}/restore`),
			{ method: 'POST', headers: { Cookie: guildCookie(cookie) } },
			testEnv(db),
		);
		expect(restoreRes.status).toBe(400);
	});

	// --- Activity feed ---

	it('logs propose activity', async () => {
		await createGame(db, cookie, { name: 'Activity Test' });

		const activityRes = await app.request(guildUrl('/api/games/activity'), { headers: { Cookie: guildCookie(cookie) } }, testEnv(db));
		const activity = await activityRes.json();
		expect(activity.data.length).toBeGreaterThanOrEqual(1);
		expect(activity.data.find((a: any) => a.action === 'propose')).toBeDefined();
	});

	it('logs like/dislike/archive/restore actions', async () => {
		const createRes = await createGame(db, cookie, { name: 'Multi Action' });
		const { data: game } = await createRes.json();

		// Like
		await app.request(
			guildUrl(`/api/games/${game.id}/react`),
			{ method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: guildCookie(cookie) }, body: JSON.stringify({ type: 'like' }) },
			testEnv(db),
		);
		// Dislike (replaces like)
		await app.request(
			guildUrl(`/api/games/${game.id}/react`),
			{ method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: guildCookie(cookie) }, body: JSON.stringify({ type: 'dislike' }) },
			testEnv(db),
		);
		// Remove reaction
		await app.request(guildUrl(`/api/games/${game.id}/react`), { method: 'DELETE', headers: { Cookie: guildCookie(cookie) } }, testEnv(db));
		// Archive
		await app.request(guildUrl(`/api/games/${game.id}`), { method: 'DELETE', headers: { Cookie: guildCookie(cookie) } }, testEnv(db));
		// Restore
		await app.request(guildUrl(`/api/games/${game.id}/restore`), { method: 'POST', headers: { Cookie: guildCookie(cookie) } }, testEnv(db));

		const activityRes = await app.request(guildUrl('/api/games/activity'), { headers: { Cookie: guildCookie(cookie) } }, testEnv(db));
		const activity = await activityRes.json();
		const actions = activity.data.map((a: any) => a.action);
		expect(actions).toContain('propose');
		expect(actions).toContain('like');
		expect(actions).toContain('dislike');
		expect(actions).toContain('unreact');
		expect(actions).toContain('archive');
		expect(actions).toContain('restore');
	});

	it('activity feed paginates', async () => {
		for (let i = 0; i < 25; i++) {
			await createGame(db, cookie, { name: `Game ${i}` });
		}

		const page1Res = await app.request(guildUrl('/api/games/activity?limit=20'), { headers: { Cookie: guildCookie(cookie) } }, testEnv(db));
		const page1 = await page1Res.json();
		expect(page1.data).toHaveLength(20);

		const lastEntry = page1.data[page1.data.length - 1];
		const page2Res = await app.request(
			guildUrl(`/api/games/activity?limit=20&before=${lastEntry.created_at}`),
			{ headers: { Cookie: guildCookie(cookie) } },
			testEnv(db),
		);
		const page2 = await page2Res.json();
		expect(page2.data).toHaveLength(5);
	});

	// --- Image upgrade on propose ---

	it('upgrades search thumbnail to header image', async () => {
		const res = await createGame(db, cookie, {
			name: 'CS2',
			steam_app_id: '730',
			image_url: 'https://store.steampowered.com/search/capsule_sm_120.jpg',
		});
		const { data: game } = await res.json();
		expect(game.image_url).toBe('https://cdn.akamai.steamstatic.com/steam/apps/730/header.jpg');
	});

	// --- Ranking includes likes ---

	it('ranking includes like_count', async () => {
		const createRes = await createGame(db, cookie, { name: 'Ranked Game' });
		const { data: game } = await createRes.json();

		await app.request(
			guildUrl(`/api/games/${game.id}/react`),
			{ method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: guildCookie(cookie) }, body: JSON.stringify({ type: 'like' }) },
			testEnv(db),
		);

		const rankRes = await app.request(guildUrl('/api/games/ranking'), { headers: { Cookie: guildCookie(cookie) } }, testEnv(db));
		const ranking = await rankRes.json();
		expect(ranking.data[0].like_count).toBe(1);
	});

	// --- Pool query param ---

	it('supports pool query param', async () => {
		const createRes = await createGame(db, cookie, { name: 'Pool Test' });
		const { data: game } = await createRes.json();

		await app.request(guildUrl(`/api/games/${game.id}`), { method: 'DELETE', headers: { Cookie: guildCookie(cookie) } }, testEnv(db));

		const activeRes = await app.request(guildUrl('/api/games?pool=active'), { headers: { Cookie: guildCookie(cookie) } }, testEnv(db));
		const active = await activeRes.json();
		expect(active.data).toHaveLength(0);

		const archiveRes = await app.request(guildUrl('/api/games?pool=archive'), { headers: { Cookie: guildCookie(cookie) } }, testEnv(db));
		const archive = await archiveRes.json();
		expect(archive.data).toHaveLength(1);
		expect(archive.data[0].is_archived).toBe(true);

		const allRes = await app.request(guildUrl('/api/games?pool=all'), { headers: { Cookie: guildCookie(cookie) } }, testEnv(db));
		const all = await allRes.json();
		expect(all.data).toHaveLength(1);
	});

	// --- Share ranking includes steam_app_id ---

	it('share ranking metadata includes steam_app_id and like_count', async () => {
		const createRes = await createGame(db, cookie, { name: 'CS2', steam_app_id: '730' });
		const { data: game } = await createRes.json();

		await app.request(
			guildUrl(`/api/games/${game.id}/react`),
			{ method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: guildCookie(cookie) }, body: JSON.stringify({ type: 'like' }) },
			testEnv(db),
		);

		await app.request(
			guildUrl(`/api/games/${game.id}/vote`),
			{ method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: guildCookie(cookie) }, body: JSON.stringify({ rank: 1 }) },
			testEnv(db),
		);

		const shareRes = await app.request(
			guildUrl('/api/rally/share-ranking'),
			{ method: 'POST', headers: { Cookie: guildCookie(cookie) } },
			testEnv(db),
		);
		const share = await shareRes.json();
		expect(share.ok).toBe(true);

		const rankingMeta = share.data.metadata.ranking;
		expect(rankingMeta[0].steam_app_id).toBe('730');
		expect(rankingMeta[0].like_count).toBe(1);
	});
});
