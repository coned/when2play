-- Rallies (one per day, game-agnostic)
CREATE TABLE rallies (
  id TEXT PRIMARY KEY,
  creator_id TEXT NOT NULL REFERENCES users(id),
  timing TEXT NOT NULL DEFAULT 'now',
  day_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL
);
CREATE INDEX idx_rallies_status ON rallies(status);

-- Rally Actions (all interactions in the rally system)
CREATE TABLE rally_actions (
  id TEXT PRIMARY KEY,
  rally_id TEXT REFERENCES rallies(id),
  actor_id TEXT NOT NULL REFERENCES users(id),
  action_type TEXT NOT NULL,
  target_user_ids TEXT,
  message TEXT,
  metadata TEXT,
  delivered INTEGER NOT NULL DEFAULT 0,
  day_key TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_rally_actions_rally ON rally_actions(rally_id);
CREATE INDEX idx_rally_actions_day ON rally_actions(day_key);
CREATE INDEX idx_rally_actions_delivered ON rally_actions(delivered);
CREATE INDEX idx_rally_actions_type ON rally_actions(action_type, day_key);

-- Pending tree share requests (web -> bot sends image)
CREATE TABLE rally_tree_shares (
  id TEXT PRIMARY KEY,
  requested_by TEXT NOT NULL REFERENCES users(id),
  day_key TEXT NOT NULL,
  image_data TEXT,
  delivered INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_tree_shares_delivered ON rally_tree_shares(delivered);
