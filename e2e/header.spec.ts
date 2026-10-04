import { test, expect, mockLoggedIn, fixClock, ok, fail, USER } from './fixtures';

test.beforeEach(async ({ page }) => {
	await fixClock(page);
});

test('profile menu: synced name is locked, an empty name is refused, a failed save keeps the menu open', async ({ page, api }) => {
	mockLoggedIn(api, { ...USER, sync_name_from_discord: true });
	api.on('PATCH', '/users/me', fail(500, 'INTERNAL_ERROR', 'Database is locked'));
	await page.goto('/');

	const trigger = page.getByRole('button', { name: /profile and settings/ });
	await trigger.click();
	const menu = page.getByRole('dialog', { name: 'Profile and settings' });
	const name = menu.getByLabel('Display Name');
	await expect(name).toBeDisabled();
	await expect(menu).toContainText('replaces this on every login');

	await menu.getByLabel('Sync name from Discord').uncheck();
	await expect(name).toBeEnabled();
	await name.fill('   ');
	await expect(menu.getByRole('button', { name: 'Save' })).toBeDisabled();
	await expect(menu).toContainText('cannot be empty');

	await name.fill('Alicia');
	await menu.getByRole('button', { name: 'Save' }).click();
	await expect(menu.getByRole('alert')).toContainText('Database is locked');
	await expect(menu).toBeVisible();
	const patch = api.calls('PATCH', '/users/me');
	expect(patch).toHaveLength(1);
	expect(patch[0].body).toEqual({ display_name: 'Alicia', sync_name_from_discord: false });

	// A click outside closes it and focus goes back to the trigger
	await page.getByRole('heading', { name: 'Dashboard' }).click();
	await expect(menu).toHaveCount(0);
	await expect(trigger).toBeFocused();

	api.on('PATCH', '/users/me', (req) => ok({ ...USER, ...(req.body as object) }));
	await trigger.click();
	await menu.getByLabel('Sync name from Discord').uncheck();
	await menu.getByLabel('Display Name').fill('Alicia');
	await menu.getByRole('button', { name: 'Save' }).click();
	await expect(menu).toHaveCount(0);
	await expect(trigger).toHaveAttribute('aria-expanded', 'false');
});
