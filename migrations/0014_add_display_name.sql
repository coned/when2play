ALTER TABLE users ADD COLUMN display_name TEXT;
ALTER TABLE users ADD COLUMN sync_name_from_discord INTEGER NOT NULL DEFAULT 1;
