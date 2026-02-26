ALTER TABLE gather_pings ADD COLUMN is_anonymous INTEGER NOT NULL DEFAULT 0;
ALTER TABLE gather_pings ADD COLUMN target_user_ids TEXT;
