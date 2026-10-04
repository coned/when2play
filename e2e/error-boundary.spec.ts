import { test, expect, mockLoggedIn, fixClock, ok } from './fixtures';

test('a tab that throws while rendering shows a message; navigation and other tabs keep working', async ({ page, api }) => {
	await fixClock(page);
	mockLoggedIn(api);
	// A shape the Games tab cannot render: a game whose reaction_users is not a list
	api.get('/games', ok([{ id: 'g1', name: 'Broken', proposed_by: 'u-bob', like_count: 0, dislike_count: 0, user_reaction: null, reaction_users: 5 }]));
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));

	await page.goto('/#/games');

	const alert = page.getByRole('alert');
	await expect(alert).toContainText('Something went wrong');
	await expect(alert.getByRole('button', { name: 'Reload' })).toBeVisible();
	// Header and navigation survive
	await expect(page.getByRole('banner')).toBeVisible();
	const nav = page.getByRole('navigation');
	await expect(nav.getByRole('button', { name: 'Games' })).toBeVisible();

	// Another tab renders, and switching tabs clears the error
	await nav.getByRole('button', { name: 'Rally' }).click();
	await expect(page.getByRole('heading', { name: 'Rally', exact: true })).toBeVisible();
	await expect(page.getByText('Something went wrong')).toHaveCount(0);
	await nav.getByRole('button', { name: 'Shame Wall' }).click();
	await expect(page.getByRole('heading', { name: /Shame/ }).first()).toBeVisible();
	await expect(page.getByText('Something went wrong')).toHaveCount(0);

	// Back on the broken tab the boundary catches it again
	await nav.getByRole('button', { name: 'Games' }).click();
	await expect(page.getByRole('alert')).toContainText('Something went wrong');
	expect(errors).toEqual([]);
});
