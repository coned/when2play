import { test, expect, mockLoggedIn, fixClock, ok, fail, USER, BOB, TODAY, type ApiMock, type MockRequest } from './fixtures';
import type { Page } from '@playwright/test';

/** A row as GET /api/availability returns it */
function row(userId: string, start: string, opts: { status?: string; slot_status?: string } = {}) {
	const [h, m] = start.split(':').map(Number);
	const endMin = (h * 60 + m + 15) % (24 * 60);
	const end = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;
	return {
		id: `${userId}-${start}`,
		user_id: userId,
		date: TODAY,
		start_time: start,
		end_time: end,
		slot_status: opts.slot_status ?? 'available',
		status: opts.status ?? 'manual',
	};
}

/**
 * GET /availability answers: the user's own rows for `?user_id=`, everyone's otherwise.
 * `mine` and `all` are read on every request, so a test can change them.
 */
function mockAvailabilityRows(api: ApiMock, data: { mine: unknown[]; all: unknown[] }) {
	api.get('/availability', (req: MockRequest) => ok(req.url.searchParams.get('user_id') ? data.mine : data.all));
}

const slot = (page: Page, time: string) => page.locator(`[data-time="${time}"]`);

async function openAvailability(page: Page) {
	await page.goto('/');
	await page.getByRole('navigation').getByRole('button', { name: 'Availability' }).click();
}

/** Slots as the PUT body lists them */
const putTimes = (body: unknown) =>
	((body as { slots: Array<{ start_time: string }> }).slots ?? []).map((s) => s.start_time);

test.beforeEach(async ({ page, api }) => {
	await fixClock(page);
	mockLoggedIn(api);
});

test('tentative day: auto-filled slots stay selected when the status arrives after the slots', async ({ page, api }) => {
	const tentative = ['21:00', '21:15', '21:30'].map((t) => row(USER.id, t, { status: 'tentative' }));
	mockAvailabilityRows(api, { mine: [], all: [...tentative, row(BOB.id, '21:00')] });
	// The status map arrives well after both slot requests
	api.get('/availability/my-status', { delay: 1200, ...ok({ [TODAY]: { status: 'tentative' } }) });
	api.put('/availability', (req) => ok((req.body as { slots: unknown[] }).slots));

	await openAvailability(page);

	for (const t of ['21:00', '21:15', '21:30']) {
		await expect(slot(page, t)).toHaveAttribute('aria-pressed', 'true');
	}
	await expect(slot(page, '22:00')).toHaveAttribute('aria-pressed', 'false');
	await expect(page.getByText('Auto-filled from last week')).toBeVisible();

	await slot(page, '22:00').click();
	await expect(slot(page, '22:00')).toHaveAttribute('aria-pressed', 'true');

	await expect.poll(() => api.calls('PUT', '/availability').length, { timeout: 5000 }).toBe(1);
	const [put] = api.calls('PUT', '/availability');
	expect((put.body as { date: string }).date).toBe(TODAY);
	expect(putTimes(put.body)).toEqual(['21:00', '21:15', '21:30', '22:00']);
	await expect(page.getByRole('status')).toHaveText(/Saved/);
});

test('failed save shows the server message and Retry, never "Saved"', async ({ page, api }) => {
	mockAvailabilityRows(api, { mine: [], all: [] });
	api.put('/availability', fail(500, 'INTERNAL_ERROR', 'Database is locked'));

	await openAvailability(page);
	await slot(page, '21:00').click();

	const alert = page.getByRole('alert').filter({ hasText: 'not saved' });
	await expect(alert).toContainText('Database is locked');
	await expect(alert.getByRole('button', { name: 'Retry' })).toBeVisible();
	await expect(page.getByRole('status')).toHaveText('Save failed');

	api.put('/availability', (req) => ok((req.body as { slots: unknown[] }).slots));
	await alert.getByRole('button', { name: 'Retry' }).click();

	await expect(alert).toHaveCount(0);
	await expect(page.getByRole('status')).toHaveText(/Saved/);
	const puts = api.calls('PUT', '/availability');
	expect(puts).toHaveLength(2);
	expect(putTimes(puts[1].body)).toEqual(['21:00']);
});

test('overlapping saves run one at a time and the last one carries the final selection', async ({ page, api }) => {
	mockAvailabilityRows(api, { mine: [], all: [] });
	api.put('/availability', (req) => ({ delay: 1500, ...ok((req.body as { slots: unknown[] }).slots) }));

	await openAvailability(page);

	await slot(page, '21:00').click();
	// Wait until the first save is in flight, then change the selection twice while it runs
	await expect.poll(() => api.calls('PUT', '/availability').length, { timeout: 5000 }).toBe(1);
	await slot(page, '21:15').click();
	await page.waitForTimeout(1100);
	await slot(page, '21:30').click();
	await slot(page, '21:00').click();

	await expect(page.getByRole('status')).toHaveText(/Saved/, { timeout: 10_000 });
	const puts = api.calls('PUT', '/availability');
	expect(puts.length).toBeGreaterThanOrEqual(2);
	expect(puts.every((p) => p.finishedAt !== null)).toBe(true);
	for (let i = 1; i < puts.length; i++) {
		// Each save starts only after the previous one was answered
		expect(puts[i].startedAt).toBeGreaterThanOrEqual(puts[i - 1].finishedAt!);
	}
	expect(putTimes(puts[puts.length - 1].body)).toEqual(['21:15', '21:30']);
});
