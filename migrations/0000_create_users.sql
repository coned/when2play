CREATE TABLE users (
	id TEXT PRIMARY KEY,
	discord_id TEXT UNIQUE NOT NULL,
	discord_username TEXT NOT NULL,
	avatar_url TEXT,
	timezone TEXT NOT NULL DEFAULT 'UTC',
	time_granularity_minutes INTEGER NOT NULL DEFAULT 15,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);
