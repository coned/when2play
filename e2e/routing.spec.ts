import { test, expect, mockLoggedIn, fixClock, ok, USER } from './fixtures';

test.beforeEach(async ({ page }) => {
	await fixClock(page);
});

test('routing: tabs drive the hash, reload keeps the tab, back returns, #/admin needs an admin', async ({ page, api }) => {
	mockLoggedIn(api);
	const nav = page.getByRole('navigation', { name: 'Main' });

	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
	await expect(nav.getByRole('button', { name: 'Dashboard' })).toHaveAttribute('aria-current', 'page');
	expect(new URL(page.url()).hash).toBe('');

	await nav.getByRole('button', { name: 'Games' }).click();
	await expect(page).toHaveURL(/#\/games$/);
	await nav.getByRole('button', { name: 'Rally' }).click();
	await expect(page).toHaveURL(/#\/rally$/);
	await expect(page.getByRole('heading', { name: 'Rally' })).toBeVisible();
	await expect(nav.getByRole('button', { name: 'Rally' })).toHaveAttribute('aria-current', 'page');

	await page.reload();
	await expect(page.getByRole('heading', { name: 'Rally' })).toBeVisible();
	await expect(nav.getByRole('button', { name: 'Rally' })).toHaveAttribute('aria-current', 'page');

	await page.goBack();
	await expect(page).toHaveURL(/#\/games$/);
	await expect(nav.getByRole('button', { name: 'Games' })).toHaveAttribute('aria-current', 'page');
	await page.goForward();
	await expect(page).toHaveURL(/#\/rally$/);
	await expect(page.getByRole('heading', { name: 'Rally' })).toBeVisible();

	// The dashboard's "not set" line links to the availability tab
	await nav.getByRole('button', { name: 'Dashboard' }).click();
	await page.getByRole('link', { name: 'Set your availability' }).click();
	await expect(page).toHaveURL(/#\/availability$/);
	await expect(page.getByRole('heading', { name: 'Availability' })).toBeVisible();

	await page.goto('/#/admin');
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
	await expect(page).toHaveURL(/#\/dashboard$/);
	await expect(nav.getByRole('button', { name: 'Settings' })).toHaveCount(0);

	await page.goto('/#/nonsense');
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
	await expect(page).toHaveURL(/#\/dashboard$/);

	// The same link works for an admin
	api.get('/users/me', ok({ ...USER, is_admin: true }));
	await page.goto('about:blank');
	await page.goto('/#/admin');
	await expect(page.getByRole('heading', { name: 'Admin Settings' })).toBeVisible();
	await expect(nav.getByRole('button', { name: 'Settings' })).toHaveAttribute('aria-current', 'page');
	await expect(page).toHaveURL(/#\/admin$/);
});
