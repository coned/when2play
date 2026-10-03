import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

export const TEST_GUILD_ID = '12345678901234567';

/** BOT_API_KEY that testEnv() configures; send it as X-Bot-Token on bot-auth endpoints. */
export const TEST_BOT_KEY = 'test-bot-key';

/** Headers the Discord bot sends: its token plus the guild (bot requests take the guild from X-Guild-Id, not ?guild=). */
export const BOT_HEADERS = { 'X-Bot-Token': TEST_BOT_KEY, 'X-Guild-Id': TEST_GUILD_ID } as const;

/**
 * Build a test env object with the DB bound to the test guild and BOT_API_KEY
 * set to TEST_BOT_KEY (bot auth fails closed without a key). Pass
 * { BOT_API_KEY: undefined } in extras to test an unconfigured key.
 */
export function testEnv(db: D1Database, extras?: Record<string, unknown>): Record<string, unknown> {
	return { BOT_API_KEY: TEST_BOT_KEY, [`DB_${TEST_GUILD_ID}`]: db, ...extras };
}

/** Append ?guild=TEST_GUILD_ID to a path (handles existing query strings). */
export function guildUrl(urlPath: string): string {
	const sep = urlPath.includes('?') ? '&' : '?';
	return `${urlPath}${sep}guild=${TEST_GUILD_ID}`;
}

/** Append guild_id cookie to an existing cookie string. */
export function guildCookie(cookie: string): string {
	return `${cookie}; guild_id=${TEST_GUILD_ID}`;
}

interface D1Result {
	results: unknown[];
	success: boolean;
	meta: Record<string, unknown>;
}

/**
 * Creates a D1-compatible wrapper around better-sqlite3 for testing.
 */
export function createTestDb(): D1Database {
	const db = new Database(':memory:');
	db.pragma('foreign_keys = ON');

	// Apply all migrations
	const migrationsDir = path.join(__dirname, '..', 'migrations');
	const files = fs.readdirSync(migrationsDir).sort();
	for (const file of files) {
		if (file.endsWith('.sql')) {
			const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
			db.exec(sql);
		}
	}

	const d1: D1Database = {
		prepare(query: string) {
			return createStatement(db, query);
		},
		async exec(query: string) {
			db.exec(query);
			return { count: 0, duration: 0 } as any;
		},
		// Like D1, a batch runs as one transaction: any failing statement rolls back the whole batch.
		// Runs synchronously so concurrent batches cannot interleave inside the transaction.
		async batch(statements: any[]) {
			return db.transaction(() => statements.map((s: any) => s.runSync()))();
		},
		dump() {
			return Promise.resolve(new ArrayBuffer(0));
		},
		withSession() {
			// In-memory SQLite has no replication; return self so
			// session.prepare() uses the same DB.
			return d1 as any;
		},
	} as any;

	return d1;
}

function createStatement(db: Database.Database, query: string) {
	let bindings: unknown[] = [];

	const stmt = {
		bind(...args: unknown[]) {
			bindings = args;
			return stmt;
		},
		async first<T = unknown>(col?: string): Promise<T | null> {
			const prepared = db.prepare(query);
			const row = prepared.get(...bindings) as Record<string, unknown> | undefined;
			if (!row) return null;
			if (col) return (row as any)[col] ?? null;
			return row as T;
		},
		async all<T = unknown>(): Promise<D1Result & { results: T[] }> {
			const prepared = db.prepare(query);
			const results = prepared.all(...bindings) as T[];
			return { results, success: true, meta: {} };
		},
		async run(): Promise<D1Result> {
			return stmt.runSync();
		},
		runSync(): D1Result {
			const prepared = db.prepare(query);
			prepared.run(...bindings);
			return { results: [], success: true, meta: {} };
		},
		async raw<T = unknown[]>(): Promise<T[]> {
			const prepared = db.prepare(query);
			return prepared.raw(...bindings) as T[];
		},
	};

	return stmt;
}
