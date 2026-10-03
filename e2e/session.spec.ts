import { test, expect, mockLoggedIn, fixClock, ok, fail, USER } from './fixtures';

test.beforeEach(async ({ page }) => {
	await fixClock(page);
});

test('logged out: the login prompt explains how to get a link', async ({ page, api }) => {
	// A fresh browser has no guild cookie either
	api.get('/users/me', fail(400, 'MISSING_GUILD', 'No guild context'));

	await page.goto('/');

	await expect(page.getByText('run /when2play in your Discord server')).toBeVisible();
	await expect(page.getByText('valid for 10 minutes')).toBeVisible();
	await expect(page.getByText('Waiting for auth link')).toHaveCount(0);
	await expect(page.getByText('session has expired')).toHaveCount(0);
	await expect(page.getByText('Cannot reach the server')).toHaveCount(0);
});

test('server unreachable at start: an error with Retry, which recovers once the server answers', async ({ page, api }) => {
	mockLoggedIn(api);
	api.get('/users/me', { abort: true });

	await page.goto('/');

	const alert = page.getByRole('alert');
	await expect(alert).toContainText('Cannot reach the server');
	await expect(page.locator('.spinner')).toHaveCount(0);
	await expect(page.getByText('/when2play')).toHaveCount(0);

	api.get('/users/me', ok(USER));
	await page.getByRole('button', { name: 'Retry' }).click();

	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
	await expect(page.getByRole('alert')).toHaveCount(0);
});

test('a 401 from a later API call shows the session-expired login screen', async ({ page, api }) => {
	mockLoggedIn(api);

	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

	api.get('/rally/active', fail(401, 'UNAUTHORIZED', 'Invalid or expired session'));
	await page.getByRole('navigation').getByRole('button', { name: 'Rally' }).click();

	await expect(page.getByRole('alert')).toContainText('Your session has expired');
	await expect(page.getByText('run /when2play in your Discord server')).toBeVisible();
	await expect(page.getByRole('navigation')).toHaveCount(0);
});
