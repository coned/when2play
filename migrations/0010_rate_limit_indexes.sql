-- Indexes for the per-user rate limit checks in src/db/queries/rate-limit.ts.
-- checkRallyRateLimit filters rally_actions by actor_id (plus created_at or
-- action_type) and checkShareCooldown filters the share tables by
-- requested_by, none of which was indexed, so every check scanned the table.
CREATE INDEX IF NOT EXISTS idx_rally_actions_actor_created ON rally_actions(actor_id, created_at);
CREATE INDEX IF NOT EXISTS idx_game_shares_requested_by_created ON game_shares(requested_by, created_at);
CREATE INDEX IF NOT EXISTS idx_tree_shares_requested_by_created ON rally_tree_shares(requested_by, created_at);
