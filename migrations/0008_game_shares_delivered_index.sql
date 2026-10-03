-- Restore idx_game_shares_delivered on databases that lack it.
-- The index was added to the game_shares migration after that migration had
-- already been applied to production, so remote databases never got it.
-- Numbered 0008 because production d1_migrations already records 0000-0007
-- as applied (from before the consolidation into 0000_init.sql); a lower
-- number would never run there. IF NOT EXISTS keeps it a no-op on fresh
-- databases built from 0000_init.sql.
CREATE INDEX IF NOT EXISTS idx_game_shares_delivered ON game_shares(delivered, created_at);
