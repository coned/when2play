#!/usr/bin/env bash
set -euo pipefail

# Seed D1 with test data for local development
# Run: bash scripts/seed-data.sh

DB_PATH=".wrangler/state/v3/d1/miniflare-D1DatabaseObject"

echo "Seeding test data..."

# Find the SQLite database file
DB_FILE=$(find "$DB_PATH" -name "*.sqlite" 2>/dev/null | head -1)
if [ -z "$DB_FILE" ]; then
	echo "No local D1 database found. Run 'wrangler dev' first to initialize it."
	exit 1
fi

NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
TODAY=$(date -u +"%Y-%m-%d")
TOMORROW=$(date -u -d "+1 day" +"%Y-%m-%d" 2>/dev/null || date -u -v+1d +"%Y-%m-%d")

sqlite3 "$DB_FILE" <<SQL
PRAGMA foreign_keys = ON;

-- Test users
INSERT OR IGNORE INTO users (id, discord_id, discord_username, avatar_url, timezone, time_granularity_minutes, created_at, updated_at) VALUES
	('user-1', '111111111111111111', 'GamerDave', 'https://cdn.discordapp.com/embed/avatars/0.png', 'America/New_York', 15, '$NOW', '$NOW'),
	('user-2', '222222222222222222', 'FragMaster', 'https://cdn.discordapp.com/embed/avatars/1.png', 'America/Los_Angeles', 15, '$NOW', '$NOW'),
	('user-3', '333333333333333333', 'NightOwl', 'https://cdn.discordapp.com/embed/avatars/2.png', 'Europe/London', 30, '$NOW', '$NOW');

-- Test games
INSERT OR IGNORE INTO games (id, name, steam_app_id, image_url, proposed_by, is_archived, created_at) VALUES
	('game-1', 'Counter-Strike 2', '730', 'https://cdn.akamai.steamstatic.com/steam/apps/730/header.jpg', 'user-1', 0, '$NOW'),
	('game-2', 'Valheim', '892970', 'https://cdn.akamai.steamstatic.com/steam/apps/892970/header.jpg', 'user-2', 0, '$NOW'),
	('game-3', 'Deep Rock Galactic', '548430', 'https://cdn.akamai.steamstatic.com/steam/apps/548430/header.jpg', 'user-1', 0, '$NOW');

-- Test votes (rank 1 = top pick)
INSERT OR IGNORE INTO game_votes (id, game_id, user_id, rank, is_approved, created_at) VALUES
	('vote-1', 'game-1', 'user-1', 1, 1, '$NOW'),
	('vote-2', 'game-2', 'user-1', 2, 1, '$NOW'),
	('vote-3', 'game-1', 'user-2', 2, 1, '$NOW'),
	('vote-4', 'game-3', 'user-2', 1, 1, '$NOW'),
	('vote-5', 'game-2', 'user-3', 1, 1, '$NOW');

-- Test availability
INSERT OR IGNORE INTO availability (id, user_id, date, start_time, end_time, created_at) VALUES
	('avail-1', 'user-1', '$TODAY', '19:00', '19:15', '$NOW'),
	('avail-2', 'user-1', '$TODAY', '19:15', '19:30', '$NOW'),
	('avail-3', 'user-1', '$TODAY', '19:30', '19:45', '$NOW'),
	('avail-4', 'user-1', '$TODAY', '19:45', '20:00', '$NOW'),
	('avail-5', 'user-2', '$TODAY', '19:00', '19:15', '$NOW'),
	('avail-6', 'user-2', '$TODAY', '19:15', '19:30', '$NOW'),
	('avail-7', 'user-3', '$TODAY', '20:00', '20:30', '$NOW'),
	('avail-8', 'user-3', '$TODAY', '20:30', '21:00', '$NOW');

SQL

echo "Seed data inserted successfully."
echo "Users: GamerDave, FragMaster, NightOwl"
echo "Games: Counter-Strike 2, Valheim, Deep Rock Galactic"
