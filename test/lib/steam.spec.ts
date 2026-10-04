import { describe, it, expect, afterEach, vi } from 'vitest';
import app from '../../src/index';
import { decodeHtmlEntities, searchSteamApps } from '../../src/lib/steam';
import { createTestDb, guildUrl, testEnv } from '../setup';
import { apiRequest, createAuthenticatedUser } from '../helpers';

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('decodeHtmlEntities', () => {
	it('decodes named and numeric references', () => {
		expect(decodeHtmlEntities('Command &amp; Conquer')).toBe('Command & Conquer');
		expect(decodeHtmlEntities('&quot;Q&quot; &lt;3 &gt; &apos;x&#39;')).toBe('"Q" <3 > \'x\'');
		expect(decodeHtmlEntities('Portal&trade; 2 &#174; &#x2122;')).toBe('Portal™ 2 ® ™');
		expect(decodeHtmlEntities('Pok&#233;mon &#X1F3AE;')).toBe('Pokémon \u{1F3AE}');
	});

	it('keeps unknown or invalid references as written', () => {
		expect(decodeHtmlEntities('A &bogus; B & C &#0; &#xD800; &#99999999;')).toBe('A &bogus; B & C &#0; &#xD800; &#99999999;');
	});

	it('decodes only once', () => {
		expect(decodeHtmlEntities('&amp;amp;')).toBe('&amp;');
	});
});

describe('searchSteamApps', () => {
	it('returns decoded names (fake Steam response)', async () => {
		const html = [
			'<a data-ds-appid="2229850"><div class="match_name">Command &amp; Conquer&trade; Remastered</div><img src="https://cdn.example/1.jpg"></a>',
			'<a data-ds-appid="10"><div class="match_name">Counter-Strike: &#8220;Classic&#8221;</div><img src="https://cdn.example/2.jpg"></a>',
		].join('');
		const fetchFake = vi.fn(async () => new Response(html, { status: 200 }));
		vi.stubGlobal('fetch', fetchFake);

		const results = await searchSteamApps('command');
		expect(fetchFake).toHaveBeenCalledTimes(1);
		expect(results).toEqual([
			{ app_id: '2229850', name: 'Command & Conquer™ Remastered', image_url: 'https://cdn.example/1.jpg' },
			{ app_id: '10', name: 'Counter-Strike: “Classic”', image_url: 'https://cdn.example/2.jpg' },
		]);
	});
});

describe('GET /api/steam/lookup/:appId', () => {
	it('requires a session', async () => {
		const fetchFake = vi.fn(async () => new Response('{}', { status: 200 }));
		vi.stubGlobal('fetch', fetchFake);
		const db = createTestDb();
		const res = await app.request(guildUrl('/api/steam/lookup/730'), {}, testEnv(db));
		expect(res.status).toBe(401);
		expect(fetchFake).not.toHaveBeenCalled();
	});

	it('looks up an app for a signed-in user (fake Steam response)', async () => {
		const fetchFake = vi.fn(async () =>
			new Response(JSON.stringify({ '730': { success: true, data: { name: 'Counter-Strike 2', header_image: 'https://cdn.example/h.jpg' } } }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			}),
		);
		const db = createTestDb();
		const { cookie } = await createAuthenticatedUser(db, '7001', 'ivy');
		vi.stubGlobal('fetch', fetchFake);
		const res = await apiRequest(db, cookie, 'GET', '/api/steam/lookup/730');
		expect(res.status).toBe(200);
		expect(res.body.data).toEqual({ name: 'Counter-Strike 2', header_image: 'https://cdn.example/h.jpg' });
	});
});
