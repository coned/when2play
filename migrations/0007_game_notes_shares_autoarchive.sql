-- Game notes
ALTER TABLE games ADD COLUMN note TEXT;

-- Track last meaningful activity for auto-archive
ALTER TABLE games ADD COLUMN last_activity_at TEXT;

-- Backfill last_activity_at from created_at for existing rows
UPDATE games SET last_activity_at = created_at WHERE last_activity_at IS NULL;

-- Game shares for Discord broadcast (similar to rally_tree_shares)
CREATE TABLE IF NOT EXISTS game_shares (
    id TEXT PRIMARY KEY,
    game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    requested_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    delivered INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_game_shares_delivered ON game_shares (delivered, created_at);

-- Auto-archive enabled setting (default true)
INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES ('auto_archive_enabled', 'true', datetime('now'));
