INSERT INTO settings (key, value, updated_at)
  VALUES ('rally_button_labels', '{}', datetime('now'))
  ON CONFLICT(key) DO NOTHING;

INSERT INTO settings (key, value, updated_at)
  VALUES ('rally_suggested_phrases', '{}', datetime('now'))
  ON CONFLICT(key) DO NOTHING;

INSERT INTO settings (key, value, updated_at)
  VALUES ('rally_show_discord_command', 'true', datetime('now'))
  ON CONFLICT(key) DO NOTHING;
