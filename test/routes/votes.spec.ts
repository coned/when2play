import { describe, it, expect, beforeEach } from 'vitest';
import app from '../../src/index';
import { createTestDb, guildUrl, guildCookie, testEnv } from '../setup';

async function createAuthenticatedUser(db: D1Database, discordId: string, username: string) {
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

describe('Vote routes', () => {
	let db: D1Database;
	let cookie1: string;
	let cookie2: string;
	let gameId: string;

	beforeEach(async () => {
		db = createTestDb();
		cookie1 = await createAuthenticatedUser(db, '111', 'User1');
		cookie2 = await createAuthenticatedUser(db, '222', 'User2');

		// Create a game
		const res = await app.request(
			guildUrl('/api/games'),
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Cookie: guildCookie(cookie1) },
				body: JSON.stringify({ name: 'Test Game' }),
			},
			testEnv(db),
		);
		const { data } = await res.json();
		gameId = data.id;
	});

	it('sets and retrieves votes', async () => {
		// Vote
		const voteRes = await app.request(
			guildUrl(`/api/games/${gameId}/vote`),
			{
				method: 'PUT',
				headers: { 'Content-Type': 'application/json', Cookie: guildCookie(cookie1) },
				body: JSON.stringify({ rank: 1 }),
			},
			testEnv(db),
		);
		expect(voteRes.status).toBe(200);
		const vote = await voteRes.json();
		expect(vote.data.rank).toBe(1);
		expect(vote.data.is_approved).toBe(true);

		// Get votes for game
		const votesRes = await app.request(guildUrl(`/api/games/${gameId}/votes`), { headers: { Cookie: guildCookie(cookie1) } }, testEnv(db));
		const votes = await votesRes.json();
		expect(votes.data).toHaveLength(1);
	});

	it('updates existing vote', async () => {
		// First vote
		await app.request(
			guildUrl(`/api/games/${gameId}/vote`),
			{
				method: 'PUT',
				headers: { 'Content-Type': 'application/json', Cookie: guildCookie(cookie1) },
				body: JSON.stringify({ rank: 1 }),
			},
			testEnv(db),
		);

		// Update
		const updateRes = await app.request(
			guildUrl(`/api/games/${gameId}/vote`),
			{
				method: 'PUT',
				headers: { 'Content-Type': 'application/json', Cookie: guildCookie(cookie1) },
				body: JSON.stringify({ rank: 3, is_approved: false }),
			},
			testEnv(db),
		);
		const updated = await updateRes.json();
		expect(updated.data.rank).toBe(3);
		expect(updated.data.is_approved).toBe(false);
	});

	it('computes Borda ranking', async () => {
		// Create second game
		const game2Res = await app.request(
			guildUrl('/api/games'),
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Cookie: guildCookie(cookie1) },
				body: JSON.stringify({ name: 'Game 2' }),
			},
			testEnv(db),
		);
		const game2Id = (await game2Res.json()).data.id;

		// User1: rank 1 = Test Game, rank 2 = Game 2
		await app.request(
			guildUrl(`/api/games/${gameId}/vote`),
			{ method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: guildCookie(cookie1) }, body: JSON.stringify({ rank: 1 }) },
			testEnv(db),
		);
		await app.request(
			guildUrl(`/api/games/${game2Id}/vote`),
			{ method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: guildCookie(cookie1) }, body: JSON.stringify({ rank: 2 }) },
			testEnv(db),
		);

		// User2: rank 1 = Game 2, rank 2 = Test Game
		await app.request(
			guildUrl(`/api/games/${game2Id}/vote`),
			{ method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: guildCookie(cookie2) }, body: JSON.stringify({ rank: 1 }) },
			testEnv(db),
		);
		await app.request(
			guildUrl(`/api/games/${gameId}/vote`),
			{ method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: guildCookie(cookie2) }, body: JSON.stringify({ rank: 2 }) },
			testEnv(db),
		);

		// Both should tie: each gets 2+1 = 3 points total
		const rankRes = await app.request(guildUrl('/api/games/ranking'), { headers: { Cookie: guildCookie(cookie1) } }, testEnv(db));
		const ranking = await rankRes.json();
		expect(ranking.data).toHaveLength(2);
		expect(ranking.data[0].total_score).toBe(ranking.data[1].total_score);
	});

	it('deletes a vote', async () => {
		await app.request(
			guildUrl(`/api/games/${gameId}/vote`),
			{ method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: guildCookie(cookie1) }, body: JSON.stringify({ rank: 1 }) },
			testEnv(db),
		);

		const deleteRes = await app.request(
			guildUrl(`/api/games/${gameId}/vote`),
			{ method: 'DELETE', headers: { Cookie: guildCookie(cookie1) } },
			testEnv(db),
		);
		expect(deleteRes.status).toBe(200);

		const votesRes = await app.request(guildUrl(`/api/games/${gameId}/votes`), { headers: { Cookie: guildCookie(cookie1) } }, testEnv(db));
		const votes = await votesRes.json();
		expect(votes.data).toHaveLength(0);
	});
});
