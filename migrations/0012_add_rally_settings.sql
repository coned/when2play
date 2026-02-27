INSERT INTO settings (key, value, updated_at)
  VALUES ('day_reset_hour_et', '8', datetime('now'))
  ON CONFLICT(key) DO NOTHING;
