import { test, expect, mockLoggedIn, fixClock, ok, fail, USER, BOB } from './fixtures';

function game(id: string, name: string, proposed_by: string, extra: Record<string, unknown> = {}) {
	return {
		id,
		name,
		steam_app_id: null,
		image_url: null,
		proposed_by,
		is_archived: false,
		created_at: '2026-07-10T00:00:00Z',
		archived_at: null,
		archive_reason: null,
		note: null,
		last_activity_at: '2026-07-14T00:00:00Z',
		like_count: 0,
		dislike_count: 0,
		user_reaction: null,
		reaction_users: [],
		...extra,
	};
}

const archived = (id: string, name: string, proposed_by: string) =>
	game(id, name, proposed_by, { is_archived: true, archived_at: '2026-07-14T12:00:00Z', archive_reason: 'not_interested' });

test.beforeEach(async ({ page, api }) => {
	await fixClock(page);
	mockLoggedIn(api);
});

/** Active and archive pools by the ?pool= parameter */
function mockGames(api: import('./fixtures').ApiMock, active: unknown[], archive: unknown[]) {
	api.get('/games', (req) => ok(req.url.searchParams.get('pool') === 'archive' ? archive : active));
}

test('games: permanent delete is offered only to the proposer and needs a second click', async ({ page, api }) => {
	mockGames(api, [], [archived('g-mine', 'Mine Game', USER.id), archived('g-bob', 'Bob Game', BOB.id)]);
	api.on('DELETE', /^\/games\/[^/]+\/permanent$/, ok(null));

	await page.goto('/#/games');
	await page.getByRole('button', { name: /Deleted \(2\)/ }).click();

	const mine = page.getByRole('article', { name: 'Mine Game' });
	const bobs = page.getByRole('article', { name: 'Bob Game' });
	await expect(bobs.getByRole('button', { name: 'Restore' })).toBeVisible();
	await expect(bobs.getByRole('button', { name: /delete/i })).toHaveCount(0);

	// First click only asks
	await mine.getByRole('button', { name: 'Delete forever' }).click();
	expect(api.requests.filter((r) => r.method === 'DELETE')).toHaveLength(0);
	await expect(mine.getByRole('group', { name: 'Confirm permanent deletion' })).toContainText('cannot be undone');

	// Cancel goes back, the second confirming click deletes
	await mine.getByRole('button', { name: 'Cancel' }).click();
	await mine.getByRole('button', { name: 'Delete forever' }).click();
	mockGames(api, [], [archived('g-bob', 'Bob Game', BOB.id)]);
	await mine.getByRole('button', { name: 'Yes, delete forever' }).click();

	await expect(page.getByRole('heading', { name: 'Mine Game' })).toHaveCount(0);
	const deletes = api.requests.filter((r) => r.method === 'DELETE');
	expect(deletes.map((r) => r.path)).toEqual(['/games/g-mine/permanent']);
});

test('games: a failed like rolls the count back and shows an error on the card', async ({ page, api }) => {
	mockGames(api, [game('g1', 'Factorio', BOB.id, { like_count: 2, reaction_users: [] })], []);
	api.put('/games/g1/react', { ...fail(500, 'INTERNAL_ERROR', 'Database is busy'), delay: 300 });

	await page.goto('/#/games');
	const card = page.getByRole('article', { name: 'Factorio' });
	const like = card.getByRole('button', { name: /^Like/ });
	await expect(like).toHaveAccessibleName('Like, 2');

	await like.click();
	// Optimistic while the request is out
	await expect(like).toHaveAccessibleName('Like, 3');
	await expect(like).toHaveAttribute('aria-pressed', 'true');

	await expect(card.getByRole('alert')).toHaveText('Could not save your like: Database is busy');
	await expect(like).toHaveAccessibleName('Like, 2');
	await expect(like).toHaveAttribute('aria-pressed', 'false');
	expect(api.calls('PUT', '/games/g1/react')).toHaveLength(1);
});
