import { test, expect, mockLoggedIn, fixClock, ok, USER, BOB, TODAY, type ApiMock } from './fixtures';
import type { Locator, Page } from '@playwright/test';

/** A row as GET /api/availability returns it */
function row(userId: string, start: string) {
	const [h, m] = start.split(':').map(Number);
	const endMin = (h * 60 + m + 15) % (24 * 60);
	const end = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;
	return { id: `${userId}-${start}`, user_id: userId, date: TODAY, start_time: start, end_time: end, slot_status: 'available', status: 'manual' };
}

function mockRows(api: ApiMock, data: { mine: unknown[]; all: unknown[] }) {
	api.get('/availability', (req) => ok(req.url.searchParams.get('user_id') ? data.mine : data.all));
}

const slot = (page: Page, time: string) => page.locator(`[data-time="${time}"]`);

async function openAvailability(page: Page) {
	await page.goto('/');
	await page.getByRole('navigation').getByRole('button', { name: /Avail/ }).click();
	await expect(slot(page, '21:00')).toBeVisible();
}

async function center(locator: Locator) {
	const box = (await locator.boundingBox())!;
	return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** A real touch gesture (start, moves, end) through the browser's input pipeline */
async function touchGesture(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 12) {
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
	for (let i = 1; i <= steps; i++) {
		const x = from.x + ((to.x - from.x) * i) / steps;
		const y = from.y + ((to.y - from.y) * i) / steps;
		await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
	}
	await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	await cdp.detach();
}

/** Every corner of the box lies inside the viewport and hits the element itself (nothing clips or covers it) */
async function expectFullyVisible(page: Page, locator: Locator) {
	const box = (await locator.boundingBox())!;
	const vp = page.viewportSize()!;
	expect(box.x).toBeGreaterThanOrEqual(0);
	expect(box.y).toBeGreaterThanOrEqual(0);
	expect(box.x + box.width).toBeLessThanOrEqual(vp.width);
	expect(box.y + box.height).toBeLessThanOrEqual(vp.height);
	const hits = await locator.evaluate((el, b) => {
		const pts = [[b.x + 2, b.y + 2], [b.x + b.width - 2, b.y + 2], [b.x + 2, b.y + b.height - 2], [b.x + b.width - 2, b.y + b.height - 2]];
		return pts.map(([x, y]) => el.contains(document.elementFromPoint(x, y)));
	}, box);
	expect(hits).toEqual([true, true, true, true]);
}

const putTimes = (body: unknown) =>
	((body as { slots: Array<{ start_time: string }> }).slots ?? []).map((s) => s.start_time);

test.beforeEach(async ({ page, api }) => {
	await fixClock(page);
	mockLoggedIn(api);
	api.put('/availability', (req) => ok((req.body as { slots: unknown[] }).slots));
});

test('a tap toggles a slot exactly once', async ({ page, api }) => {
	mockRows(api, { mine: [], all: [] });
	await openAvailability(page);
	const target = slot(page, '21:00');
	await expect(target).toHaveAttribute('aria-pressed', 'false');

	await target.tap();
	await expect(target).toHaveAttribute('aria-pressed', 'true');
	// The compatibility mouse events after the tap must not toggle it back
	await page.waitForTimeout(300);
	await expect(target).toHaveAttribute('aria-pressed', 'true');
	await expect.poll(() => api.calls('PUT', '/availability').length, { timeout: 5000 }).toBe(1);
	expect(putTimes(api.calls('PUT', '/availability')[0].body)).toEqual(['21:00']);

	await target.tap();
	await expect(target).toHaveAttribute('aria-pressed', 'false');
});

test('a vertical swipe over the grid scrolls the page and selects nothing', async ({ page, api }) => {
	mockRows(api, { mine: [], all: [] });
	await openAvailability(page);
	const main = page.locator('main');
	expect(await main.evaluate((el) => el.scrollTop)).toBe(0);

	const start = await center(slot(page, '23:00'));
	await touchGesture(page, start, { x: start.x, y: start.y - 250 });

	await expect.poll(() => main.evaluate((el) => el.scrollTop)).toBeGreaterThan(50);
	await page.waitForTimeout(1300);
	await expect(page.locator('[data-time][aria-pressed="true"]')).toHaveCount(0);
	expect(api.calls('PUT', '/availability')).toHaveLength(0);
});

test('"Drag to select" paints a range of slots and keeps the grid from scrolling', async ({ page, api }) => {
	mockRows(api, { mine: [], all: [] });
	await openAvailability(page);
	const toggle = page.getByRole('button', { name: 'Drag to select' });
	await expect(toggle).toHaveAttribute('aria-pressed', 'false');
	await toggle.tap();
	await expect(toggle).toHaveAttribute('aria-pressed', 'true');
	await expect(page.getByTestId('grid-hint')).toContainText('does not scroll');

	const main = page.locator('main');
	const before = await main.evaluate((el) => el.scrollTop);
	await touchGesture(page, await center(slot(page, '21:00')), await center(slot(page, '21:45')));

	for (const t of ['21:00', '21:15', '21:30', '21:45']) {
		await expect(slot(page, t)).toHaveAttribute('aria-pressed', 'true');
	}
	await expect(slot(page, '22:00')).toHaveAttribute('aria-pressed', 'false');
	expect(await main.evaluate((el) => el.scrollTop)).toBe(before);
	await expect.poll(() => api.calls('PUT', '/availability').length, { timeout: 5000 }).toBe(1);
	expect(putTimes(api.calls('PUT', '/availability')[0].body)).toEqual(['21:00', '21:15', '21:30', '21:45']);
});

test('tapping the avatars shows who is free without toggling the slot', async ({ page, api }) => {
	mockRows(api, { mine: [row(USER.id, '21:15')], all: [row(USER.id, '21:15'), row(BOB.id, '21:15'), row(BOB.id, '22:00')] });
	await openAvailability(page);
	const target = slot(page, '21:15');
	await expect(target).toHaveAttribute('aria-pressed', 'true');

	await target.locator('[data-avatars]').tap();
	const popover = page.getByRole('tooltip');
	await expect(popover).toBeVisible();
	await expect(popover).toContainText('Bob');
	await expect(popover).toContainText('Alice');
	await expect(target).toHaveAttribute('aria-pressed', 'true');

	// A tap elsewhere only closes it
	await slot(page, '23:00').tap();
	await expect(popover).toHaveCount(0);
	await expect(slot(page, '23:00')).toHaveAttribute('aria-pressed', 'false');

	await slot(page, '22:00').locator('[data-avatars]').tap();
	await expect(popover).toContainText('Bob');
	await expect(slot(page, '22:00')).toHaveAttribute('aria-pressed', 'false');
	await page.waitForTimeout(1300);
	expect(api.calls('PUT', '/availability')).toHaveLength(0);
});

test('the popover lies fully inside the viewport, also for a slot in the first row', async ({ page, api }) => {
	mockRows(api, { mine: [], all: [row(BOB.id, '21:00'), row(BOB.id, '03:00')] });
	await openAvailability(page);
	const popover = page.getByRole('tooltip');

	// First row of the first column: there is no room inside the column above it
	await slot(page, '21:00').locator('[data-avatars]').tap();
	await expect(popover).toBeVisible();
	await expectFullyVisible(page, popover);

	// First row of the second column, at the right edge of the screen
	await page.keyboard.press('Escape');
	await expect(popover).toHaveCount(0);
	const second = slot(page, '03:00');
	await expect(second).toBeVisible();
	await second.locator('[data-avatars]').tap();
	await expect(popover).toBeVisible();
	await expectFullyVisible(page, popover);
});
