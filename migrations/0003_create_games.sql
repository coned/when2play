CREATE TABLE games (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	steam_app_id TEXT,
	image_url TEXT,
	proposed_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	is_archived INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL,
	archived_at TEXT
);

CREATE INDEX idx_games_proposed_by ON games(proposed_by);
CREATE INDEX idx_games_is_archived ON games(is_archived);
