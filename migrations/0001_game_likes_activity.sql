CREATE TABLE game_likes (
	game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	created_at TEXT NOT NULL,
	PRIMARY KEY (game_id, user_id)
);
CREATE INDEX idx_game_likes_user_id ON game_likes(user_id);

CREATE TABLE game_activity (
	id TEXT PRIMARY KEY,
	game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	action TEXT NOT NULL,
	detail TEXT,
	created_at TEXT NOT NULL
);
CREATE INDEX idx_game_activity_created_at ON game_activity(created_at);
