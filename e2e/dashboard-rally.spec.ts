import { test, expect, mockLoggedIn, fixClock, ok, USER, BOB, TODAY } from './fixtures';

test.beforeEach(async ({ page, api }) => {
	await fixClock(page);
	mockLoggedIn(api);
});

test('dashboard: a window that crosses UTC midnight is one "Who\'s Around" chip in local time', async ({ page, api }) => {
	// 21:00 to 02:00 UTC in 15 minute rows for two users (17:00 to 22:00 EDT)
	const rows: unknown[] = [];
	for (const userId of [USER.id, BOB.id]) {
		for (let m = 21 * 60; m < 26 * 60; m += 15) {
			const start = m % (24 * 60);
			const end = (m + 15) % (24 * 60);
			const hhmm = (x: number) => `${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
			rows.push({ id: `${userId}-${m}`, user_id: userId, date: TODAY, start_time: hhmm(start), end_time: hhmm(end), slot_status: 'available', status: 'manual' });
		}
	}
	expect(rows).toContainEqual(expect.objectContaining({ user_id: USER.id, start_time: '23:45', end_time: '00:00' }));
	api.get('/availability', ok(rows));

	await page.goto('/');

	const around = page.getByRole('region', { name: /Who's Around/ });
	await expect(around).toBeVisible();
	const chips = around.getByRole('listitem');
	await expect(chips).toHaveCount(1);
	await expect(chips.first()).toContainText('5:00 PM – 10:00 PM EDT');
	await expect(chips.first()).not.toContainText('+1');
	expect(api.calls('GET', '/availability')[0].url.searchParams.get('date')).toBe(TODAY);
});

test('rally: offline bot banner, expired delivery label, no banner when the bot is online', async ({ page, api }) => {
	const action = {
		id: 'a1',
		rally_id: 'r1',
		actor_id: BOB.id,
		action_type: 'in',
		actor_username: 'bob',
		actor_avatar: null,
		target_user_ids: null,
		message: null,
		metadata: null,
		created_at: '2026-07-15T15:00:00Z',
		delivery_status: 'expired',
	};
	const rally = { id: 'r1', timing: 'now', day_key: TODAY, status: 'open', created_at: '2026-07-15T14:55:00Z' };
	api.get('/rally/active', ok({ rally, actions: [action], bot: { online: false, last_seen_at: '2026-07-15T10:00:00Z' } }));

	await page.goto('/');
	await page.getByRole('navigation').getByRole('button', { name: 'Rally' }).click();

	await expect(page.getByRole('alert')).toContainText('Discord bot is not picking up messages');
	await expect(page.getByText('expired', { exact: true })).toBeVisible();

	api.get('/rally/active', ok({ rally, actions: [{ ...action, delivery_status: 'delivered' }], bot: { online: true, last_seen_at: '2026-07-15T15:59:00Z' } }));
	await page.reload();
	await page.getByRole('navigation').getByRole('button', { name: 'Rally' }).click();

	await expect(page.getByText('delivered', { exact: true })).toBeVisible();
	await expect(page.getByRole('alert')).toHaveCount(0);
});

test('dashboard: one line sums up today\'s rally and links to it; nothing without a rally', async ({ page, api }) => {
	const base = { rally_id: 'r1', actor_avatar: null, target_user_ids: null, message: null, metadata: null, delivery_status: 'delivered' };
	const rally = { id: 'r1', timing: 'now', day_key: TODAY, status: 'open', created_at: '2026-07-15T14:55:00Z' };
	api.get('/rally/active', ok({
		rally,
		actions: [
			{ ...base, id: 'a1', actor_id: BOB.id, actor_username: 'bob', action_type: 'in', created_at: '2026-07-15T15:00:00Z' },
			{ ...base, id: 'a2', actor_id: USER.id, actor_username: 'alice', action_type: 'brb', created_at: '2026-07-15T15:01:00Z' },
			{ ...base, id: 'a3', actor_id: USER.id, actor_username: 'alice', action_type: 'in', created_at: '2026-07-15T15:02:00Z' },
			{ ...base, id: 'a4', actor_id: '__anonymous__', actor_username: 'Anonymous', action_type: 'out', metadata: { is_anonymous: true }, created_at: '2026-07-15T15:03:00Z' },
		],
		bot: { online: true, last_seen_at: '2026-07-15T15:59:00Z' },
	}));

	await page.goto('/');
	const link = page.getByRole('link', { name: /Rally today/ });
	await expect(link).toHaveText(/Rally today: 2 in$/);
	await link.click();
	await expect(page).toHaveURL(/#\/rally$/);

	api.get('/rally/active', ok({ rally: null, actions: [], bot: { online: true, last_seen_at: '2026-07-15T15:59:00Z' } }));
	await page.goto('/#/dashboard');
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
	await expect(page.getByRole('link', { name: /Rally today/ })).toHaveCount(0);
});
