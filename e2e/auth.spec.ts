import { test, expect, mockLoggedIn, fixClock, fail, type ApiMock } from './fixtures';

const GUILD = '200000000000000001';

/** What the Worker answers for a good token: a 302 to / that sets the session cookies */
function mockGoodToken(api: ApiMock, token: string) {
	api.get(`/auth/callback/${token}`, (req) => {
		expect(req.url.searchParams.get('guild')).toBe(GUILD);
		return {
			status: 302,
			headers: {
				location: '/',
				'cache-control': 'no-store',
				'set-cookie': `guild_id=${GUILD}; Max-Age=604800; Path=/; HttpOnly; SameSite=Strict`,
			},
			body: '',
		};
	});
}

test.beforeEach(async ({ page }) => {
	await fixClock(page);
});

test('auth callback: a used link shows a readable page, a good link ends on the dashboard', async ({ page, api, context }) => {
	api.get('/auth/callback/tok-used', fail(401, 'INVALID_TOKEN', 'Token is invalid, expired, or already used'));
	api.get('/users/me', fail(400, 'MISSING_GUILD', 'No guild context'));

	await page.goto(`/auth/tok-used?guild=${GUILD}`);

	await expect(page.getByRole('alert')).toContainText('This login link has expired or was already used');
	await expect(page.getByText('/when2play')).toBeVisible();
	await expect(page.locator('body')).not.toContainText('INVALID_TOKEN');
	await expect(page.locator('body')).not.toContainText('"ok"');
	expect(page.url()).toContain('/auth/tok-used');

	mockGoodToken(api, 'tok-good');
	mockLoggedIn(api);
	await page.goto(`/auth/tok-good?guild=${GUILD}`);

	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
	expect(new URL(page.url()).pathname).toBe('/');
	expect(api.calls('GET', '/auth/callback/tok-good')).toHaveLength(1);
	// The cookie from the 302 response was stored, as for a navigation
	const cookies = await context.cookies();
	expect(cookies).toContainEqual(expect.objectContaining({ name: 'guild_id', value: GUILD, httpOnly: true, sameSite: 'Strict' }));
});

test('auth callback: a used link with a live session for that guild opens the app; a network failure offers Retry', async ({ page, api }) => {
	mockLoggedIn(api);
	api.get('/auth/callback/tok-old', fail(401, 'INVALID_TOKEN', 'Token is invalid, expired, or already used'));

	await page.goto(`/auth/tok-old?guild=${GUILD}`);
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

	api.get('/auth/callback/tok-net', { abort: true });
	await page.goto(`/auth/tok-net?guild=${GUILD}`);
	await expect(page.getByRole('alert')).toContainText('Cannot reach the server');
	await expect(page.getByRole('alert')).toContainText('not used yet');

	mockGoodToken(api, 'tok-net');
	await page.getByRole('button', { name: 'Retry' }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
});

test('a deep link opened while logged out lands on its tab after logging in with a fresh link', async ({ page, api }) => {
	api.get('/users/me', fail(401, 'UNAUTHORIZED', 'No session cookie'));
	await page.goto('/#/rally');
	await expect(page.getByText('run /when2play in your Discord server')).toBeVisible();

	mockGoodToken(api, 'tok-deep');
	mockLoggedIn(api);
	await page.goto(`/auth/tok-deep?guild=${GUILD}`);

	await expect(page.getByRole('heading', { name: 'Rally' })).toBeVisible();
	expect(new URL(page.url()).hash).toBe('#/rally');
});
