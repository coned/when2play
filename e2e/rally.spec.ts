import { test, expect, mockLoggedIn, fixClock, ok, fail, USER, BOB, TODAY } from './fixtures';

const CAROL = { id: 'u-carol', discord_username: 'carol', display_name: 'Carol', avatar_url: null };
const RALLY = { id: 'r1', timing: 'now', day_key: TODAY, status: 'open', created_at: '2026-07-15T14:55:00Z' };

let seq = 0;
function action(actor: { id: string; discord_username: string }, action_type: string, time: string, extra: Record<string, unknown> = {}) {
	seq += 1;
	return {
		id: `a${seq}`,
		rally_id: 'r1',
		actor_id: actor.id,
		action_type,
		actor_username: actor.discord_username,
		actor_avatar: null,
		target_user_ids: null,
		message: null,
		metadata: null,
		created_at: `${TODAY}T${time}:00.000Z`,
		delivery_status: 'delivered',
		...extra,
	};
}

const ONLINE = { online: true, last_seen_at: '2026-07-15T15:59:00Z' };

test.beforeEach(async ({ page, api }) => {
	await fixClock(page);
	mockLoggedIn(api);
	api.get('/users', ok([
		{ id: USER.id, discord_username: USER.discord_username, display_name: USER.display_name, avatar_url: null },
		BOB,
		CAROL,
	]));
});

async function openRally(page: import('@playwright/test').Page) {
	await page.goto('/#/rally');
	await expect(page.getByRole('heading', { name: 'Rally', exact: true })).toBeVisible();
}

test('rally roster: latest answer wins, anonymous actions are ignored, the current user is marked', async ({ page, api }) => {
	const anon = { id: '__anonymous__', discord_username: 'Anonymous' };
	api.get('/rally/active', ok({
		rally: RALLY,
		actions: [
			action(USER, 'call', '14:55'),
			action(BOB, 'in', '15:00'),
			action(USER, 'brb', '15:01'),
			action(CAROL, 'in', '15:02'),
			action(BOB, 'out', '15:05'),
			action(USER, 'in', '15:06'),
			// Anonymous answers name nobody, so they are not on the roster
			action(anon, 'out', '15:07', { metadata: { is_anonymous: true } }),
			action(anon, 'brb', '15:08', { metadata: { is_anonymous: true } }),
		],
		bot: ONLINE,
	}));

	await openRally(page);

	const inGroup = page.getByRole('group', { name: /^In \(/ });
	const brbGroup = page.getByRole('group', { name: /^BRB \(/ });
	const outGroup = page.getByRole('group', { name: /^Out \(/ });
	await expect(inGroup).toHaveAccessibleName('In (2)');
	await expect(brbGroup).toHaveAccessibleName('BRB (0)');
	await expect(outGroup).toHaveAccessibleName('Out (1)');

	// Each chip: initial (no avatar), name and "(you)" for the current user
	await expect(inGroup.getByRole('listitem')).toHaveText([/^A\s*Alice\s*\(you\)$/, /^C\s*Carol$/]);
	await expect(outGroup.getByRole('listitem')).toHaveText([/^B\s*Bob$/]);
	await expect(brbGroup).toContainText('Nobody');
	await expect(page.getByRole('region', { name: "Today's roster" })).not.toContainText('Anonymous');

	// The raw log is still there below the roster
	await expect(page.getByRole('heading', { name: "Today's actions" })).toBeVisible();
});

test('rally roster: clear empty state when nobody has answered', async ({ page }) => {
	await openRally(page);
	await expect(page.getByRole('region', { name: "Today's roster" })).toContainText('No rally yet today');
});

test('rally: one tap on In sends exactly one action without a message', async ({ page, api }) => {
	api.post('/rally/action', (req) => ({
		status: 201,
		json: { ok: true, data: { ...action(USER, 'in', '16:00'), ...(req.body as object) } },
	}));

	await openRally(page);
	await page.getByRole('button', { name: 'In', exact: true }).click();

	const status = page.getByRole('status');
	await expect(status).toHaveText("You're in!");
	const calls = api.calls('POST', '/rally/action');
	expect(calls).toHaveLength(1);
	expect(calls[0].body).toEqual({ action_type: 'in' });
	// No compose area was opened
	await expect(page.getByRole('textbox', { name: 'Message' })).toHaveCount(0);

	// The success message goes away by itself after about 4 seconds
	await expect(status).toHaveText('', { timeout: 6_000 });

	// The secondary control still lets a message go with it
	await page.getByRole('button', { name: 'In with a message' }).click();
	await page.getByRole('textbox', { name: 'Message' }).fill('5 min');
	await page.getByRole('button', { name: 'Send', exact: true }).click();
	await expect(status).toHaveText("You're in!");
	expect(api.calls('POST', '/rally/action')[1].body).toEqual({ action_type: 'in', message: '5 min' });
});

test('rally: a 429 answer shows the server message as an alert until the next action', async ({ page, api }) => {
	const message = 'Slow down: at most 5 rally actions a minute. Try again in 40 seconds.';
	api.post('/rally/action', fail(429, 'RATE_LIMITED', message));

	await openRally(page);
	await page.getByRole('button', { name: 'Out', exact: true }).click();

	const alert = page.getByRole('alert');
	await expect(alert).toHaveText(message);
	await expect(page.getByRole('status')).toHaveText('');

	// Still there a while later; gone when the next action starts
	await page.waitForTimeout(500);
	await expect(alert).toHaveText(message);
	await page.getByRole('button', { name: /Ping/ }).click();
	await expect(page.getByRole('alert')).toHaveCount(0);
});

test('rally: the Anonymous choice does not carry over to another action', async ({ page }) => {
	await openRally(page);
	await page.getByRole('button', { name: /Call/ }).click();
	const anon = page.getByRole('checkbox', { name: /Anonymous/ });
	await anon.check();
	await page.getByRole('button', { name: /Ping/ }).click();
	await expect(anon).not.toBeChecked();
});

test('rally: an admin session works and "Administrator" is not in the user picker', async ({ page, api }) => {
	const ADMIN_USER = {
		...USER,
		id: 'u-admin',
		discord_id: 'system-admin-200000000000000001',
		discord_username: 'Administrator',
		display_name: 'Administrator',
		is_admin: true,
	};
	mockLoggedIn(api, ADMIN_USER);
	// GET /api/users leaves the admin pseudo user out
	api.get('/users', ok([
		{ id: USER.id, discord_username: USER.discord_username, display_name: USER.display_name, avatar_url: null },
		BOB,
	]));

	await openRally(page);
	// Signed in as the admin: the header badge and the admin tab are there
	await expect(page.getByRole('banner').getByText('Admin', { exact: true })).toBeVisible();
	await expect(page.getByRole('navigation').getByRole('button', { name: 'Settings' })).toBeVisible();
	await page.getByRole('button', { name: /Ping/ }).click();

	const picker = page.getByRole('group', { name: 'Select users' });
	await expect(picker.getByRole('button')).toHaveText(['Alice', 'Bob']);
	await expect(picker).not.toContainText('Administrator');
});
