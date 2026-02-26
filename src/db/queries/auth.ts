import type { D1Database } from '@cloudflare/workers-types';
import { uuid, now } from '../helpers';

export interface AuthTokenRow {
	id: string;
	token: string;
	user_id: string;
	expires_at: string;
	used: number;
	is_admin: number;
	created_at: string;
}

export interface SessionRow {
	id: string;
	session_id: string;
	user_id: string;
	expires_at: string;
	is_admin: number;
	created_at: string;
}

const TOKEN_EXPIRY_MINUTES = 10;
const SESSION_EXPIRY_DAYS = 7;
const SESSION_EXPIRY_HOURS = 1;

export async function createAuthToken(db: D1Database, userId: string, token: string, isAdmin = false): Promise<AuthTokenRow> {
	const id = uuid();
	const timestamp = now();
	const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_MINUTES * 60 * 1000).toISOString();
	const isAdminInt = isAdmin ? 1 : 0;

	await db
		.prepare('INSERT INTO auth_tokens (id, token, user_id, expires_at, used, is_admin, created_at) VALUES (?, ?, ?, ?, 0, ?, ?)')
		.bind(id, token, userId, expiresAt, isAdminInt, timestamp)
		.run();

	return { id, token, user_id: userId, expires_at: expiresAt, used: 0, is_admin: isAdminInt, created_at: timestamp };
}

export async function consumeAuthToken(db: D1Database, token: string): Promise<AuthTokenRow | null> {
	const row = await db.prepare('SELECT * FROM auth_tokens WHERE token = ? AND used = 0').bind(token).first<AuthTokenRow>();

	if (!row) return null;
	if (new Date(row.expires_at) < new Date()) {
		await db.prepare('DELETE FROM auth_tokens WHERE id = ?').bind(row.id).run();
		return null;
	}

	await db.prepare('UPDATE auth_tokens SET used = 1 WHERE id = ?').bind(row.id).run();
	return row;
}

export async function createSession(db: D1Database, userId: string, sessionId: string, isAdmin = false): Promise<SessionRow> {
	const id = uuid();
	const timestamp = now();
	const expiresAt = isAdmin
		? new Date(Date.now() + SESSION_EXPIRY_HOURS * 60 * 60 * 1000).toISOString()
		: new Date(Date.now() + SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000).toISOString();
	const isAdminInt = isAdmin ? 1 : 0;

	await db
		.prepare('INSERT INTO sessions (id, session_id, user_id, expires_at, is_admin, created_at) VALUES (?, ?, ?, ?, ?, ?)')
		.bind(id, sessionId, userId, expiresAt, isAdminInt, timestamp)
		.run();

	return { id, session_id: sessionId, user_id: userId, expires_at: expiresAt, is_admin: isAdminInt, created_at: timestamp };
}

export async function getSessionBySessionId(db: D1Database, sessionId: string): Promise<SessionRow | null> {
	const row = await db.prepare('SELECT * FROM sessions WHERE session_id = ?').bind(sessionId).first<SessionRow>();

	if (!row) return null;
	if (new Date(row.expires_at) < new Date()) {
		await db.prepare('DELETE FROM sessions WHERE id = ?').bind(row.id).run();
		return null;
	}

	return row;
}

export async function deleteSession(db: D1Database, sessionId: string): Promise<void> {
	await db.prepare('DELETE FROM sessions WHERE session_id = ?').bind(sessionId).run();
}

export async function deleteExpiredTokens(db: D1Database): Promise<void> {
	await db.prepare('DELETE FROM auth_tokens WHERE expires_at < ?').bind(now()).run();
}
