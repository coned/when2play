CREATE TABLE game_reactions (
	game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	type TEXT NOT NULL,
	created_at TEXT NOT NULL,
	PRIMARY KEY (game_id, user_id)
);
CREATE INDEX idx_game_reactions_user_id ON game_reactions(user_id);

INSERT INTO game_reactions (game_id, user_id, type, created_at)
	SELECT game_id, user_id, 'like', created_at FROM game_likes;

DROP TABLE game_likes;

ALTER TABLE games ADD COLUMN archive_reason TEXT;
