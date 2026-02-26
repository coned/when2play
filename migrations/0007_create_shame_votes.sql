CREATE TABLE shame_votes (
	id TEXT PRIMARY KEY,
	voter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	target_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	reason TEXT,
	created_at TEXT NOT NULL,
	UNIQUE(voter_id, target_id, created_at)
);

CREATE INDEX idx_shame_votes_voter_id ON shame_votes(voter_id);
CREATE INDEX idx_shame_votes_target_id ON shame_votes(target_id);
