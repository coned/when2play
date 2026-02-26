-- D1 schema for cone-quest gaming poll bot
-- Apply locally:     wrangler d1 migrations apply cone-quest-db --local
-- Apply production:  wrangler d1 migrations apply cone-quest-db

CREATE TABLE polls (
  id            TEXT    PRIMARY KEY,        -- UUID (crypto.randomUUID())
  guild_id      TEXT    NOT NULL,
  channel_id    TEXT    NOT NULL,
  message_id    TEXT,                       -- set after bot posts the poll message
  proposer_id   TEXT    NOT NULL,
  proposer_name TEXT    NOT NULL,
  game_name     TEXT    NOT NULL,
  created_at    INTEGER NOT NULL,           -- Unix timestamp (seconds)
  expires_at    INTEGER NOT NULL,           -- created_at + 43200 (12 hours)
  closed_at     INTEGER,                    -- NULL while still open
  status        TEXT    NOT NULL DEFAULT 'open'  -- 'open' | 'closed'
);

CREATE TABLE poll_slots (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  poll_id    TEXT    NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  label      TEXT    NOT NULL,              -- e.g. "Fri Feb 28 8:00pm"
  slot_order INTEGER NOT NULL              -- display order (0-based)
);

-- One row per person per poll. UNIQUE ensures each person votes once.
-- Changing vote: UPDATE this row.
CREATE TABLE votes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  poll_id     TEXT    NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  voter_id    TEXT    NOT NULL,             -- Discord user snowflake
  voter_name  TEXT    NOT NULL,
  vote_type   TEXT    NOT NULL,            -- 'yes' | 'no'
  voted_at    INTEGER NOT NULL,
  UNIQUE(poll_id, voter_id)
);

-- Which time slots a yes-voter selected (many-to-many)
CREATE TABLE vote_slots (
  vote_id  INTEGER NOT NULL REFERENCES votes(id) ON DELETE CASCADE,
  slot_id  INTEGER NOT NULL REFERENCES poll_slots(id) ON DELETE CASCADE,
  PRIMARY KEY (vote_id, slot_id)
);

-- Indexes for analytics queries
CREATE INDEX idx_polls_guild    ON polls(guild_id, created_at DESC);
CREATE INDEX idx_polls_status   ON polls(status, expires_at);
CREATE INDEX idx_votes_poll     ON votes(poll_id);
CREATE INDEX idx_vote_slots     ON vote_slots(slot_id);
