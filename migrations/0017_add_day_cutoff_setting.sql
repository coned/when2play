INSERT INTO settings (key, value, updated_at)
  VALUES ('day_cutoff_hour_et', '5', datetime('now'))
  ON CONFLICT(key) DO NOTHING;
