/**
 * Local dev server that runs the Hono app on Node.js with a real SQLite DB.
 * This bypasses wrangler/workerd entirely.
 *
 * Usage: npx tsx scripts/serve-local.ts
 */
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename2 = typeof __filename !== 'undefined' ? __filename : fileURLToPath(import.meta.url);
const __dirname2 = path.dirname(__filename2);
const rootDir = path.resolve(__dirname2, '..');

// --- Set up SQLite DB with D1-compatible wrapper ---

const dbDir = path.join(rootDir, '.wrangler');
fs.mkdirSync(dbDir, { recursive: true });
const dbPath = path.join(dbDir, 'local.sqlite');

const sqlite = new Database(dbPath);
sqlite.pragma('foreign_keys = ON');
sqlite.pragma('journal_mode = WAL');

// Apply migrations
const migrationsDir = path.join(rootDir, 'migrations');
const migrationFiles = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();

sqlite.exec(`CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT)`);

for (const file of migrationFiles) {
	const existing = sqlite.prepare('SELECT 1 FROM _migrations WHERE name = ?').get(file);
	if (!existing) {
		const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
		sqlite.exec(sql);
		sqlite.prepare('INSERT INTO _migrations (name, applied_at) VALUES (?, ?)').run(file, new Date().toISOString());
		console.log(`Applied migration: ${file}`);
	}
}

// D1-compatible wrapper
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
		async all<T = unknown>(): Promise<{ results: T[]; success: boolean; meta: Record<string, unknown> }> {
			const prepared = db.prepare(query);
			const results = prepared.all(...bindings) as T[];
			return { results, success: true, meta: {} };
		},
		async run() {
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

const d1 = {
	prepare(query: string) {
		return createStatement(sqlite, query);
	},
	async exec(query: string) {
		sqlite.exec(query);
		return { count: 0, duration: 0 };
	},
	batch(statements: any[]) {
		return Promise.all(statements.map((s: any) => s.all()));
	},
	dump() {
		return Promise.resolve(new ArrayBuffer(0));
	},
} as any;

// --- Import the Hono app ---

import apiApp from '../src/index';

// Create a wrapper that injects the DB binding and serves static files
const app = new Hono();

// Serve static frontend assets
const frontendDist = path.join(rootDir, 'frontend', 'dist');

if (fs.existsSync(frontendDist)) {
	app.use('/assets/*', serveStatic({ root: './frontend/dist/' }));
}

// Forward /api/* to the Hono app with DB binding
app.all('/api/*', async (c) => {
	const env = { DB: d1 };
	return apiApp.fetch(c.req.raw, env, {});
});

// SPA fallback — serve index.html for all other routes
app.get('*', async (c) => {
	const indexPath = path.join(frontendDist, 'index.html');
	if (fs.existsSync(indexPath)) {
		const html = fs.readFileSync(indexPath, 'utf-8');
		return c.html(html);
	}
	return c.text('Frontend not built. Run: npm run build', 404);
});

// --- Start server ---

const port = parseInt(process.env.PORT || '8787');
console.log(`\nwhen2play local server starting...`);
console.log(`Database: ${dbPath}\n`);

serve({ fetch: app.fetch, port }, (info) => {
	console.log(`Server running at http://localhost:${info.port}`);
	console.log(`\nTo create a test user, run:`);
	console.log(`  bash scripts/simulate-bot.sh`);
});
