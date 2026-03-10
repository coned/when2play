-- Seed default; DO NOTHING preserves any existing admin customization.
INSERT INTO settings (key, value, updated_at)
VALUES ('rally_anonymous_enabled', '{"call":true,"ping":true}', datetime('now'))
ON CONFLICT(key) DO NOTHING;
