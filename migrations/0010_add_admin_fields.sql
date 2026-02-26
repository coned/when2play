ALTER TABLE auth_tokens ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;
DELETE FROM settings WHERE key = 'gather_cooldown_minutes';
INSERT INTO settings (key, value, updated_at) VALUES ('gather_cooldown_seconds', '10', datetime('now')) ON CONFLICT(key) DO NOTHING;
INSERT INTO settings (key, value, updated_at) VALUES ('gather_hourly_limit', '30', datetime('now')) ON CONFLICT(key) DO NOTHING;
