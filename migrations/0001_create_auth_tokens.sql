CREATE TABLE auth_tokens (
	id TEXT PRIMARY KEY,
	token TEXT UNIQUE NOT NULL,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	expires_at TEXT NOT NULL,
	used INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL
);

CREATE INDEX idx_auth_tokens_token ON auth_tokens(token);
CREATE INDEX idx_auth_tokens_user_id ON auth_tokens(user_id);
