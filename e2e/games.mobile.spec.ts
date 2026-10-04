import { test, expect, mockLoggedIn, fixClock, ok, BOB } from './fixtures';

test('games: like and dislike are at least 44 by 44 px on a phone', async ({ page, api }) => {
	await fixClock(page);
	mockLoggedIn(api);
	api.get('/games', (req) =>
		ok(req.url.searchParams.get('pool') === 'archive' ? [] : [{
			id: 'g1', name: 'Factorio', steam_app_id: null, image_url: null, proposed_by: BOB.id, is_archived: false,
			created_at: '2026-07-10T00:00:00Z', archived_at: null, archive_reason: null, note: null,
			last_activity_at: '2026-07-14T00:00:00Z', like_count: 0, dislike_count: 0, user_reaction: null, reaction_users: [],
		}]),
	);

	await page.goto('/#/games');
	for (const name of ['Like', 'Dislike']) {
		const box = (await page.getByRole('button', { name, exact: true }).boundingBox())!;
		expect(box.width, name).toBeGreaterThanOrEqual(44);
		expect(box.height, name).toBeGreaterThanOrEqual(44);
	}
});
