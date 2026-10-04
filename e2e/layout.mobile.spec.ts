import { test, expect, mockLoggedIn, fixClock, USER } from './fixtures';
import type { Page } from '@playwright/test';

const ADMIN = { ...USER, is_admin: true };

/** Neither the document nor the main area can be scrolled sideways */
async function expectNoHorizontalOverflow(page: Page) {
	const width = page.viewportSize()!.width;
	expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
	expect(await page.locator('main').evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
	expect(await page.locator('header').evaluate((el) => el.scrollWidth - el.clientWidth)).toBe(0);
}

test.beforeEach(async ({ page }) => {
	await fixClock(page);
	await page.setViewportSize({ width: 360, height: 740 });
});

test('no horizontal page overflow at 360 px on the dashboard and availability pages', async ({ page, api }) => {
	// An admin has the most header items and all eight tabs
	mockLoggedIn(api, ADMIN);
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
	await expectNoHorizontalOverflow(page);

	await page.getByRole('navigation').getByRole('button', { name: /Avail/ }).tap();
	await expect(page.locator('[data-time="21:00"]')).toBeVisible();
	await expectNoHorizontalOverflow(page);
});

test('every bottom nav item is at least 44 px tall and its label is not cut off', async ({ page, api }) => {
	mockLoggedIn(api, ADMIN);
	await page.goto('/');
	const items = page.getByRole('navigation').getByRole('button');
	await expect(items).toHaveCount(8);
	for (const item of await items.all()) {
		const box = (await item.boundingBox())!;
		expect(box.height).toBeGreaterThanOrEqual(44);
		expect(await item.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
	}
	// The bar sits flush with the bottom of the screen and the main area clears it
	const nav = (await page.getByRole('navigation').boundingBox())!;
	expect(nav.y + nav.height).toBeCloseTo(740, 0);
	expect(nav.height).toBeGreaterThanOrEqual(56);
});

test('a user without an avatar opens the profile menu, changes the theme there and closes it with Escape', async ({ page, api }) => {
	mockLoggedIn(api, { ...USER, avatar_url: null });
	await page.goto('/');
	const trigger = page.getByRole('button', { name: /profile and settings/ });
	await expect(trigger).toBeVisible();
	await expect(trigger).toHaveAttribute('aria-expanded', 'false');
	await expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
	const tb = (await trigger.boundingBox())!;
	expect(tb.width).toBeGreaterThanOrEqual(44);
	expect(tb.height).toBeGreaterThanOrEqual(44);
	// The theme controls are not in the phone header
	await expect(page.locator('header').getByRole('button', { name: 'Ocean theme' })).toHaveCount(0);

	await trigger.tap();
	await expect(trigger).toHaveAttribute('aria-expanded', 'true');
	const menu = page.getByRole('dialog', { name: 'Profile and settings' });
	await expect(menu).toBeVisible();

	const ocean = menu.getByRole('button', { name: 'Ocean theme' });
	const ob = (await ocean.boundingBox())!;
	expect(ob.width).toBeGreaterThanOrEqual(44);
	expect(ob.height).toBeGreaterThanOrEqual(44);
	await ocean.tap();
	await expect(ocean).toHaveAttribute('aria-pressed', 'true');
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'ocean');

	const light = menu.getByRole('button', { name: 'Light mode' });
	await light.tap();
	await expect(page.locator('html')).toHaveAttribute('data-mode', 'light');
	await expect(light).toHaveAttribute('aria-pressed', 'true');

	await page.keyboard.press('Escape');
	await expect(menu).toHaveCount(0);
	await expect(trigger).toHaveAttribute('aria-expanded', 'false');
	await expect(trigger).toBeFocused();
	// The choice sticks after the menu is gone
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'ocean');
});
