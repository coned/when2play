#!/usr/bin/env bash
set -euo pipefail

if [ $# -lt 2 ]; then
    echo "Usage: $0 <guild-name> <guild-id>"
    echo "  guild-name: Human-readable name for the D1 database (e.g. 'my-friends')"
    echo "  guild-id:   Discord guild (server) snowflake ID (17-20 digits)"
    exit 1
fi

GUILD_NAME=$1
GUILD_ID=$2

if ! [[ "$GUILD_ID" =~ ^[0-9]{17,20}$ ]]; then
    echo "Error: guild-id must be a 17-20 digit numeric string (Discord snowflake)"
    exit 1
fi

echo "Creating D1 database: when2play-${GUILD_NAME}"
npx wrangler d1 create "when2play-${GUILD_NAME}"

echo ""
echo "Next steps:"
echo "  1. Add the following binding to wrangler.jsonc d1_databases array:"
echo "     {"
echo "       \"binding\": \"DB_${GUILD_ID}\","
echo "       \"database_name\": \"when2play-${GUILD_NAME}\","
echo "       \"database_id\": \"<database-id from above>\","
echo "       \"migrations_dir\": \"migrations\""
echo "     }"
echo "  2. Run: npx wrangler d1 migrations apply when2play-${GUILD_NAME} --remote"
echo "  3. Run: npx wrangler deploy"
echo "  4. Run /setchannel in the guild's Discord channel"
