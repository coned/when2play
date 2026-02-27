INSERT INTO settings (key, value, updated_at)
  VALUES ('avail_start_hour_et', '17', datetime('now'))
  ON CONFLICT(key) DO NOTHING;

INSERT INTO settings (key, value, updated_at)
  VALUES ('avail_end_hour_et', '3', datetime('now'))
  ON CONFLICT(key) DO NOTHING;
