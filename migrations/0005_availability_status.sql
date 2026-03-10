-- Tracks whether a user's availability for a date is confirmed, manual, or absent.
-- Tentative state is NOT stored; it is computed at query time from last-week data.
CREATE TABLE IF NOT EXISTS availability_status (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (user_id, date)
);
CREATE INDEX IF NOT EXISTS idx_avail_status_date ON availability_status(date);
