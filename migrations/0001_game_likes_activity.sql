CREATE TABLE game_reactions (
	game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	type TEXT NOT NULL,
	created_at TEXT NOT NULL,
	PRIMARY KEY (game_id, user_id)
);
CREATE INDEX idx_game_reactions_user_id ON game_reactions(user_id);

CREATE TABLE game_activity (
	id TEXT PRIMARY KEY,
	game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	action TEXT NOT NULL,
	detail TEXT,
	created_at TEXT NOT NULL
);
CREATE INDEX idx_game_activity_created_at ON game_activity(created_at);

ALTER TABLE games ADD COLUMN archive_reason TEXT;
