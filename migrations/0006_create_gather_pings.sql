CREATE TABLE gather_pings (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	message TEXT,
	delivered INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL
);

CREATE INDEX idx_gather_pings_user_id ON gather_pings(user_id);
CREATE INDEX idx_gather_pings_delivered ON gather_pings(delivered);
