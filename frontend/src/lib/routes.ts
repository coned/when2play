/**
 * Hash routes for the tabs of the app: #/dashboard, #/games, ... The hash is the
 * source of truth for the active tab, so reload keeps the tab and browser back and
 * forward move between tabs.
 */

export const TAB_IDS = ['dashboard', 'games', 'availability', 'rally', 'tree', 'shame', 'blog', 'admin'] as const;
export type TabId = (typeof TAB_IDS)[number];

export const DEFAULT_TAB: TabId = 'dashboard';

export function tabHash(tab: TabId): string {
	return `#/${tab}`;
}

/** The tab a hash names, or null when it names none (or admin for a non-admin). */
export function parseTabHash(hash: string, isAdmin: boolean): TabId | null {
	const m = /^#\/([a-z]+)\/?$/.exec(hash);
	const tab = m?.[1] as TabId | undefined;
	if (!tab || !(TAB_IDS as readonly string[]).includes(tab)) return null;
	if (tab === 'admin' && !isAdmin) return null;
	return tab;
}

// A deep link opened while logged out is remembered here so that the login link
// (which the bot sends and Discord usually opens in a new tab) lands on that tab.
// localStorage, not sessionStorage, because the login link opens in another tab.
// Kept for 15 minutes: a login link is valid for 10.
const RETURN_KEY = 'w2p_return_tab';
const RETURN_TTL_MS = 15 * 60 * 1000;

/** Remember the tab in the current hash (if any) for after the next login. */
export function rememberReturnTab(): void {
	// Admin is allowed here: whether the next session is an admin one is not known yet
	const tab = parseTabHash(window.location.hash, true);
	if (!tab || tab === DEFAULT_TAB) return;
	try {
		localStorage.setItem(RETURN_KEY, JSON.stringify({ tab, at: Date.now() }));
	} catch {
		// Storage blocked: the login lands on the dashboard
	}
}

/** The hash to open after a login ('' for the dashboard). Forgets it. */
export function takeReturnHash(): string {
	try {
		const raw = localStorage.getItem(RETURN_KEY);
		localStorage.removeItem(RETURN_KEY);
		if (!raw) return '';
		const { tab, at } = JSON.parse(raw) as { tab?: string; at?: number };
		if (typeof at !== 'number' || Date.now() - at > RETURN_TTL_MS || at > Date.now() + 60_000) return '';
		const parsed = typeof tab === 'string' ? parseTabHash(`#/${tab}`, true) : null;
		return parsed ? tabHash(parsed) : '';
	} catch {
		return '';
	}
}
