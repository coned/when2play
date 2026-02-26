CREATE TABLE game_votes (
	id TEXT PRIMARY KEY,
	game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	rank INTEGER NOT NULL,
	is_approved INTEGER NOT NULL DEFAULT 1,
	created_at TEXT NOT NULL,
	UNIQUE(game_id, user_id)
);

CREATE INDEX idx_game_votes_game_id ON game_votes(game_id);
CREATE INDEX idx_game_votes_user_id ON game_votes(user_id);
