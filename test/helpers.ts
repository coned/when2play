import app from '../src/index';
import { guildUrl, guildCookie } from './setup';

export async function createAuthenticatedAdmin(db: D1Database, discordId: string, username: string) {
	const tokenRes = await app.request(
		guildUrl('/api/auth/admin-token'),
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ discord_id: discordId, discord_username: username }),
		},
		{ DB: db },
	);
	const { data } = await tokenRes.json();
	const callbackRes = await app.request(guildUrl(`/api/auth/callback/${data.token}`), {}, { DB: db });
	const cookie = callbackRes.headers.get('set-cookie')!;
	const sessionId = cookie.match(/session_id=([^;]+)/)![1];

	const meRes = await app.request(guildUrl('/api/users/me'), { headers: { Cookie: guildCookie(`session_id=${sessionId}`) } }, { DB: db });
	const me = await meRes.json();

	return { cookie: `session_id=${sessionId}`, userId: me.data.id };
}

export async function createAuthenticatedUser(db: D1Database, discordId: string, username: string) {
	const tokenRes = await app.request(
		guildUrl('/api/auth/token'),
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ discord_id: discordId, discord_username: username }),
		},
		{ DB: db },
	);
	const { data } = await tokenRes.json();
	const callbackRes = await app.request(guildUrl(`/api/auth/callback/${data.token}`), {}, { DB: db });
	const cookie = callbackRes.headers.get('set-cookie')!;
	const sessionId = cookie.match(/session_id=([^;]+)/)![1];

	// Get user ID
	const meRes = await app.request(guildUrl('/api/users/me'), { headers: { Cookie: guildCookie(`session_id=${sessionId}`) } }, { DB: db });
	const me = await meRes.json();

	return { cookie: `session_id=${sessionId}`, userId: me.data.id };
}
