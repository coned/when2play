-- when2play schema (consolidated from migrations 0000-0004)

CREATE TABLE users (
	id TEXT PRIMARY KEY,
	discord_id TEXT UNIQUE NOT NULL,
	discord_username TEXT NOT NULL,
	avatar_url TEXT,
	timezone TEXT NOT NULL DEFAULT 'UTC',
	time_granularity_minutes INTEGER NOT NULL DEFAULT 15,
	display_name TEXT,
	sync_name_from_discord INTEGER NOT NULL DEFAULT 1,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

CREATE TABLE auth_tokens (
	id TEXT PRIMARY KEY,
	token TEXT UNIQUE NOT NULL,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	expires_at TEXT NOT NULL,
	used INTEGER NOT NULL DEFAULT 0,
	is_admin INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL
);
CREATE INDEX idx_auth_tokens_token ON auth_tokens(token);
CREATE INDEX idx_auth_tokens_user_id ON auth_tokens(user_id);

CREATE TABLE sessions (
	id TEXT PRIMARY KEY,
	session_id TEXT UNIQUE NOT NULL,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	expires_at TEXT NOT NULL,
	is_admin INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL
);
CREATE INDEX idx_sessions_session_id ON sessions(session_id);
CREATE INDEX idx_sessions_user_id ON sessions(user_id);

CREATE TABLE games (
	id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	steam_app_id TEXT,
	image_url TEXT,
	proposed_by TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	is_archived INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL,
	archived_at TEXT,
	image_checked_at TEXT
);
CREATE INDEX idx_games_proposed_by ON games(proposed_by);
CREATE INDEX idx_games_is_archived ON games(is_archived);

CREATE TABLE game_votes (
	id TEXT PRIMARY KEY,
	game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	rank INTEGER NOT NULL,
	is_approved INTEGER NOT NULL DEFAULT 1,
	created_at TEXT NOT NULL,
	UNIQUE(game_id, user_id)
);
CREATE INDEX idx_game_votes_game_id ON game_votes(game_id);
CREATE INDEX idx_game_votes_user_id ON game_votes(user_id);

CREATE TABLE availability (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	date TEXT NOT NULL,
	start_time TEXT NOT NULL,
	end_time TEXT NOT NULL,
	created_at TEXT NOT NULL,
	UNIQUE(user_id, date, start_time)
);
CREATE INDEX idx_availability_user_id ON availability(user_id);
CREATE INDEX idx_availability_date ON availability(date);

CREATE TABLE gather_pings (
	id TEXT PRIMARY KEY,
	user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	message TEXT,
	delivered INTEGER NOT NULL DEFAULT 0,
	is_anonymous INTEGER NOT NULL DEFAULT 0,
	target_user_ids TEXT,
	created_at TEXT NOT NULL
);
CREATE INDEX idx_gather_pings_user_id ON gather_pings(user_id);
CREATE INDEX idx_gather_pings_delivered ON gather_pings(delivered);

CREATE TABLE shame_votes (
	id TEXT PRIMARY KEY,
	voter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	target_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
	reason TEXT,
	is_anonymous INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL,
	UNIQUE(voter_id, target_id, created_at)
);
CREATE INDEX idx_shame_votes_voter_id ON shame_votes(voter_id);
CREATE INDEX idx_shame_votes_target_id ON shame_votes(target_id);

CREATE TABLE settings (
	key TEXT PRIMARY KEY,
	value TEXT NOT NULL,
	updated_at TEXT NOT NULL
);

INSERT INTO settings (key, value, updated_at) VALUES
	('time_granularity_minutes', '15', datetime('now')),
	('game_pool_lifespan_days', '7', datetime('now')),
	('gather_cooldown_seconds', '10', datetime('now')),
	('gather_hourly_limit', '30', datetime('now')),
	('day_reset_hour_et', '8', datetime('now')),
	('avail_start_hour_et', '17', datetime('now')),
	('avail_end_hour_et', '3', datetime('now')),
	('rally_button_labels', '{}', datetime('now')),
	('rally_suggested_phrases', '{}', datetime('now')),
	('rally_show_discord_command', 'true', datetime('now')),
	('day_cutoff_hour_et', '5', datetime('now')),
	('rally_anonymous_enabled', '{"call":true,"ping":true}', datetime('now'));

CREATE TABLE rallies (
	id TEXT PRIMARY KEY,
	creator_id TEXT NOT NULL REFERENCES users(id),
	timing TEXT NOT NULL DEFAULT 'now',
	day_key TEXT NOT NULL UNIQUE,
	status TEXT NOT NULL DEFAULT 'open',
	created_at TEXT NOT NULL
);
CREATE INDEX idx_rallies_status ON rallies(status);

CREATE TABLE rally_actions (
	id TEXT PRIMARY KEY,
	rally_id TEXT REFERENCES rallies(id),
	actor_id TEXT NOT NULL REFERENCES users(id),
	action_type TEXT NOT NULL,
	target_user_ids TEXT,
	message TEXT,
	metadata TEXT,
	delivered INTEGER NOT NULL DEFAULT 0,
	day_key TEXT NOT NULL,
	created_at TEXT NOT NULL
);
CREATE INDEX idx_rally_actions_rally ON rally_actions(rally_id);
CREATE INDEX idx_rally_actions_day ON rally_actions(day_key);
CREATE INDEX idx_rally_actions_delivered ON rally_actions(delivered);
CREATE INDEX idx_rally_actions_type ON rally_actions(action_type, day_key);

CREATE TABLE rally_tree_shares (
	id TEXT PRIMARY KEY,
	requested_by TEXT NOT NULL REFERENCES users(id),
	day_key TEXT NOT NULL,
	image_data TEXT,
	delivered INTEGER NOT NULL DEFAULT 0,
	created_at TEXT NOT NULL
);
CREATE INDEX idx_tree_shares_delivered ON rally_tree_shares(delivered);
