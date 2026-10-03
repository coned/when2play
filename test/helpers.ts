import app from '../src/index';
import { guildUrl, guildCookie, BOT_HEADERS, testEnv } from './setup';

export async function createAuthenticatedAdmin(db: D1Database, discordId: string, username: string) {
	const tokenRes = await app.request(
		guildUrl('/api/auth/admin-token'),
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json', ...BOT_HEADERS },
			body: JSON.stringify({ discord_id: discordId, discord_username: username }),
		},
		testEnv(db),
	);
	const { data } = await tokenRes.json();
	const callbackRes = await app.request(guildUrl(`/api/auth/callback/${data.token}`), {}, testEnv(db));
	const cookie = callbackRes.headers.get('set-cookie')!;
	const sessionId = cookie.match(/session_id=([^;]+)/)![1];

	const meRes = await app.request(guildUrl('/api/users/me'), { headers: { Cookie: guildCookie(`session_id=${sessionId}`) } }, testEnv(db));
	const me = await meRes.json();

	return { cookie: `session_id=${sessionId}`, userId: me.data.id };
}

export async function createAuthenticatedUser(db: D1Database, discordId: string, username: string) {
	const tokenRes = await app.request(
		guildUrl('/api/auth/token'),
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json', ...BOT_HEADERS },
			body: JSON.stringify({ discord_id: discordId, discord_username: username }),
		},
		testEnv(db),
	);
	const { data } = await tokenRes.json();
	const callbackRes = await app.request(guildUrl(`/api/auth/callback/${data.token}`), {}, testEnv(db));
	const cookie = callbackRes.headers.get('set-cookie')!;
	const sessionId = cookie.match(/session_id=([^;]+)/)![1];

	// Get user ID
	const meRes = await app.request(guildUrl('/api/users/me'), { headers: { Cookie: guildCookie(`session_id=${sessionId}`) } }, testEnv(db));
	const me = await meRes.json();

	return { cookie: `session_id=${sessionId}`, userId: me.data.id };
}

/** Call a guild-scoped route as a cookie user; returns status and parsed JSON body. */
export async function apiRequest(
	db: D1Database,
	cookie: string,
	method: string,
	urlPath: string,
	body?: unknown,
	env?: Record<string, unknown>,
): Promise<{ status: number; body: any }> {
	const init: RequestInit = { method, headers: { 'Content-Type': 'application/json', Cookie: guildCookie(cookie) } };
	if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body);
	const res = await app.request(guildUrl(urlPath), init, env ?? testEnv(db));
	return { status: res.status, body: await res.json() };
}

/** Overwrite one row of the settings table (value is JSON-encoded unless it is a string). */
export async function setSettingRaw(db: D1Database, key: string, value: unknown): Promise<void> {
	const serialized = typeof value === 'string' ? value : JSON.stringify(value);
	await db
		.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
		.bind(key, serialized, new Date().toISOString())
		.run();
}
