import type { D1Database } from '@cloudflare/workers-types';

export async function enableForeignKeys(db: D1Database): Promise<void> {
	await db.exec('PRAGMA foreign_keys = ON');
}

export function uuid(): string {
	return crypto.randomUUID();
}

export function now(): string {
	return new Date().toISOString();
}
