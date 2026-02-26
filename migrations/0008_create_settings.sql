CREATE TABLE settings (
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

INSERT INTO settings (key, value, updated_at) VALUES
	('time_granularity_minutes', '15', datetime('now')),
	('game_pool_lifespan_days', '7', datetime('now')),
	('gather_cooldown_minutes', '30', datetime('now'));
