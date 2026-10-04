import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../setup';
import { apiRequest, createAuthenticatedUser } from '../helpers';

describe('Game route validation', () => {
	let db: D1Database;
	let cookie: string;

	beforeEach(async () => {
		db = createTestDb();
		({ cookie } = await createAuthenticatedUser(db, '5001', 'gina'));
	});

	const post = (body: unknown) => apiRequest(db, cookie, 'POST', '/api/games', body);

	it('POST / rejects bodies that are not JSON objects with 400', async () => {
		for (const body of ['not json', '[]', 'null', '"x"']) {
			const res = await post(body);
			expect(res.status, body).toBe(400);
			expect(res.body.error.code).toBe('BAD_REQUEST');
		}
	});

	it('POST / trims name and requires 1 to 100 characters', async () => {
		const ok = await post({ name: '  Factorio  ' });
		expect(ok.status).toBe(201);
		expect(ok.body.data.name).toBe('Factorio');
		for (const name of [undefined, '', '   ', 'x'.repeat(101), 12]) {
			expect((await post({ name })).status, String(name)).toBe(400);
		}
	});

	it('POST / accepts digits only in steam_app_id', async () => {
		expect((await post({ name: 'CS2', steam_app_id: '730' })).status).toBe(201);
		for (const steam_app_id of ['730/../../evil', 'abc', '12345678901', '', 730, ' 730']) {
			expect((await post({ name: 'Bad', steam_app_id })).status, String(steam_app_id)).toBe(400);
		}
	});

	it('POST / accepts only http(s) image URLs up to 500 characters', async () => {
		expect((await post({ name: 'A', image_url: 'https://cdn.example.com/a.jpg' })).status).toBe(201);
		expect((await post({ name: 'B', image_url: 'http://cdn.example.com/b.jpg' })).status).toBe(201);
		for (const image_url of ['javascript:alert(1)', 'data:image/png;base64,AAAA', 'not a url', `https://e.com/${'x'.repeat(500)}`, 5]) {
			expect((await post({ name: 'C', image_url })).status, String(image_url).slice(0, 30)).toBe(400);
		}
	});

	it('POST / limits note to 500 characters', async () => {
		expect((await post({ name: 'N', note: 'n'.repeat(500) })).status).toBe(201);
		expect((await post({ name: 'M', note: 'n'.repeat(501) })).status).toBe(400);
	});

	it('PATCH /:id validates name, image_url, note and the body', async () => {
		const created = await post({ name: 'Original' });
		const id = created.body.data.id;
		const patch = (body: unknown) => apiRequest(db, cookie, 'PATCH', `/api/games/${id}`, body);

		const ok = await patch({ name: '  Renamed ', note: 'fun' });
		expect(ok.status).toBe(200);
		expect(ok.body.data.name).toBe('Renamed');
		expect(ok.body.data.note).toBe('fun');

		expect((await patch('not json')).status).toBe(400);
		expect((await patch('[1]')).status).toBe(400);
		expect((await patch({ name: '' })).status).toBe(400);
		expect((await patch({ name: 'x'.repeat(101) })).status).toBe(400);
		expect((await patch({ image_url: 'ftp://e.com/a.png' })).status).toBe(400);
		expect((await patch({ note: 'n'.repeat(501) })).status).toBe(400);
	});

	it('DELETE /:id accepts only the reasons the web app sends', async () => {
		const ids: string[] = [];
		for (const name of ['G1', 'G2', 'G3', 'G4']) ids.push((await post({ name })).body.data.id);

		expect((await apiRequest(db, cookie, 'DELETE', `/api/games/${ids[0]}`, { reason: 'not_interested' })).status).toBe(200);
		expect((await apiRequest(db, cookie, 'DELETE', `/api/games/${ids[1]}`, { reason: 'save_for_later' })).status).toBe(200);
		// No body still archives as not_interested
		expect((await apiRequest(db, cookie, 'DELETE', `/api/games/${ids[2]}`)).status).toBe(200);

		for (const body of [{ reason: 'auto_archived' }, { reason: 'x'.repeat(5000) }, { reason: 3 }, 'not json']) {
			const res = await apiRequest(db, cookie, 'DELETE', `/api/games/${ids[3]}`, body);
			expect(res.status, JSON.stringify(body).slice(0, 30)).toBe(400);
		}
		const archived = await apiRequest(db, cookie, 'GET', '/api/games?pool=archive');
		expect(archived.body.data.map((g: any) => g.archive_reason).sort()).toEqual(['not_interested', 'not_interested', 'save_for_later']);
	});

	it('PUT /:id/react answers 400 to a bad body', async () => {
		const id = (await post({ name: 'R' })).body.data.id;
		expect((await apiRequest(db, cookie, 'PUT', `/api/games/${id}/react`, 'not json')).status).toBe(400);
		expect((await apiRequest(db, cookie, 'PUT', `/api/games/${id}/react`, { type: 'love' })).status).toBe(400);
	});
});

describe('Vote route validation', () => {
	let db: D1Database;
	let cookie: string;
	let gameId: string;

	beforeEach(async () => {
		db = createTestDb();
		({ cookie } = await createAuthenticatedUser(db, '6001', 'hank'));
		gameId = (await apiRequest(db, cookie, 'POST', '/api/games', { name: 'Voted' })).body.data.id;
	});

	it('PUT /:id/vote requires an integer rank from 1 to 1000', async () => {
		const vote = (body: unknown) => apiRequest(db, cookie, 'PUT', `/api/games/${gameId}/vote`, body);
		expect((await vote({ rank: 1 })).status).toBe(200);
		expect((await vote({ rank: 1000, is_approved: false })).status).toBe(200);
		for (const body of [{ rank: 0 }, { rank: -1 }, { rank: 1.5 }, { rank: 1001 }, { rank: '1' }, {}, { rank: 1, is_approved: 'yes' }, 'not json', '[]']) {
			const res = await vote(body);
			expect(res.status, JSON.stringify(body)).toBe(400);
			expect(res.body.error.code).toBe('BAD_REQUEST');
		}
	});

	it('PUT /reorder-votes requires 1 to 200 { game_id, rank } entries', async () => {
		const reorder = (body: unknown) => apiRequest(db, cookie, 'PUT', '/api/games/reorder-votes', body);
		await apiRequest(db, cookie, 'PUT', `/api/games/${gameId}/vote`, { rank: 1 });
		expect((await reorder({ rankings: [{ game_id: gameId, rank: 2 }] })).status).toBe(200);

		const tooMany = Array.from({ length: 201 }, (_, i) => ({ game_id: `g${i}`, rank: i + 1 }));
		const bad: unknown[] = [
			'not json',
			'[]',
			{},
			{ rankings: [] },
			{ rankings: 'x' },
			{ rankings: [{ game_id: gameId }] },
			{ rankings: [{ game_id: gameId, rank: 0 }] },
			{ rankings: [{ game_id: gameId, rank: 2.5 }] },
			{ rankings: [{ game_id: 5, rank: 1 }] },
			{ rankings: [null] },
			{ rankings: tooMany },
		];
		for (const body of bad) {
			const res = await reorder(body);
			expect(res.status, JSON.stringify(body).slice(0, 40)).toBe(400);
		}
		const exactly200 = Array.from({ length: 200 }, (_, i) => ({ game_id: `g${i}`, rank: i + 1 }));
		expect((await reorder({ rankings: exactly200 })).status).toBe(200);
	});
});
