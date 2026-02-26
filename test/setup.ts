import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

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
		batch(statements: any[]) {
			return Promise.all(statements.map((s: any) => s.all()));
		},
		dump() {
			return Promise.resolve(new ArrayBuffer(0));
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
