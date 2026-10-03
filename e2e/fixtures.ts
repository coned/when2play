import { test as base, expect, type Page, type Route } from '@playwright/test';

/**
 * Mocked API for the smoke suite. Every request to /api/** goes through
 * `ApiMock.handle`; a request no handler matches is aborted and recorded, and
 * the test fails at teardown. Handlers registered later win over earlier ones,
 * so a test can override a default.
 */

export interface MockRequest {
	method: string;
	url: URL;
	/** Path below /api, e.g. "/availability" */
	path: string;
	body: unknown;
}

export interface MockResponse {
	status?: number;
	json?: unknown;
	/** Raw body instead of JSON */
	body?: string;
	contentType?: string;
	headers?: Record<string, string>;
	/** Delay before answering, in ms */
	delay?: number;
	/** Abort the request (network failure) */
	abort?: boolean;
	/** Wait for this promise before answering */
	until?: Promise<unknown>;
}

type Handler = MockResponse | ((req: MockRequest) => MockResponse | Promise<MockResponse>);
type PathMatcher = string | RegExp | ((path: string, url: URL) => boolean);

interface Entry {
	method: string;
	match: PathMatcher;
	handler: Handler;
}

export interface RecordedRequest extends MockRequest {
	/** Time the request reached the mock (ms, monotonic) */
	startedAt: number;
	/** Time the mock answered it (ms, monotonic), null while pending */
	finishedAt: number | null;
}

export class ApiMock {
	private entries: Entry[] = [];
	readonly requests: RecordedRequest[] = [];
	readonly unmocked: string[] = [];
	private closed = false;

	on(method: string, match: PathMatcher, handler: Handler): this {
		this.entries.push({ method: method.toUpperCase(), match, handler });
		return this;
	}

	get(match: PathMatcher, handler: Handler) { return this.on('GET', match, handler); }
	put(match: PathMatcher, handler: Handler) { return this.on('PUT', match, handler); }
	post(match: PathMatcher, handler: Handler) { return this.on('POST', match, handler); }

	/** Requests seen so far for a method and exact path */
	calls(method: string, path: string): RecordedRequest[] {
		return this.requests.filter((r) => r.method === method.toUpperCase() && r.path === path);
	}

	close() {
		this.closed = true;
	}

	private matches(m: PathMatcher, path: string, url: URL): boolean {
		if (typeof m === 'string') return m === path;
		if (m instanceof RegExp) return m.test(path);
		return m(path, url);
	}

	async handle(route: Route): Promise<void> {
		const request = route.request();
		const url = new URL(request.url());
		const method = request.method();
		const path = url.pathname.replace(/^\/api/, '');
		let body: unknown = null;
		const raw = request.postData();
		if (raw) {
			try { body = JSON.parse(raw); } catch { body = raw; }
		}
		const req: MockRequest = { method, url, path, body };
		const recorded: RecordedRequest = { ...req, startedAt: performance.now(), finishedAt: null };
		this.requests.push(recorded);

		const entry = [...this.entries].reverse().find((e) => e.method === method && this.matches(e.match, path, url));
		if (!entry) {
			this.unmocked.push(`${method} ${url.pathname}${url.search}`);
			await route.abort('failed').catch(() => {});
			return;
		}

		const res = typeof entry.handler === 'function' ? await entry.handler(req) : entry.handler;
		if (res.until) await res.until;
		if (res.delay) await new Promise((r) => setTimeout(r, res.delay));
		if (this.closed) return;
		recorded.finishedAt = performance.now();
		try {
			if (res.abort) {
				await route.abort('failed');
				return;
			}
			await route.fulfill({
				status: res.status ?? 200,
				headers: res.headers,
				contentType: res.contentType ?? (res.body !== undefined ? 'text/plain' : 'application/json'),
				body: res.body !== undefined ? res.body : JSON.stringify(res.json ?? null),
			});
		} catch {
			// The page went away while the response was delayed
		}
	}
}

export const ok = (data: unknown): MockResponse => ({ json: { ok: true, data } });
export const fail = (status: number, code: string, message: string): MockResponse => ({
	status,
	json: { ok: false, error: { code, message } },
});

export const USER = {
	id: 'u-alice',
	discord_id: '100000000000000001',
	discord_username: 'alice',
	display_name: 'Alice',
	sync_name_from_discord: true,
	avatar_url: null,
	timezone: 'America/New_York',
	time_granularity_minutes: 15,
	is_admin: false,
	created_at: '2026-01-01T00:00:00Z',
	updated_at: '2026-01-01T00:00:00Z',
};

export const BOB = { id: 'u-bob', discord_username: 'bob', display_name: 'Bob', avatar_url: null };

/** Settings the app reads; the hours are in ET */
export const SETTINGS = {
	guild_name: 'Test Guild',
	day_cutoff_hour_et: 5,
	avail_start_hour_et: 17,
	avail_end_hour_et: 3,
};

/** Defaults for a logged-in user on every tab the suite opens. */
export function mockLoggedIn(api: ApiMock, user = USER) {
	api
		.get('/users/me', ok(user))
		.get('/users', ok([
			{ id: user.id, discord_username: user.discord_username, display_name: user.display_name, avatar_url: null },
			BOB,
		]))
		.get('/settings', ok(SETTINGS))
		.get('/guilds/mine', ok({ guilds: [{ guild_id: '200000000000000001', guild_name: 'Test Guild' }], current_guild_id: '200000000000000001' }))
		.get('/games', ok([]))
		.get('/games/ranking', ok([]))
		.get('/games/my-votes', ok([]))
		.get('/games/activity', ok([]))
		.get('/availability', ok([]))
		.get('/availability/my-status', ok({}))
		.get('/rally/active', ok({ rally: null, actions: [], bot: { online: true, last_seen_at: '2026-07-15T15:59:00Z' } }))
		.get('/shame/leaderboard', ok([]))
		.get('/shame/my-votes', ok([]));
	return api;
}

/** Noon EDT on a summer day: availability "today" is 2026-07-15. */
export const NOW = new Date('2026-07-15T16:00:00Z');
export const TODAY = '2026-07-15';

export async function fixClock(page: Page, at: Date = NOW) {
	await page.clock.setFixedTime(at);
}

export const test = base.extend<{ api: ApiMock }>({
	api: [
		async ({ page }, use) => {
			const api = new ApiMock();
			await page.route('**/api/**', (route) => api.handle(route));
			await use(api);
			api.close();
			expect(api.unmocked, 'API requests without a mock').toEqual([]);
		},
		{ auto: true },
	],
});

export { expect };
