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
echo "Wrangler auto-added an entry to wrangler.jsonc, but it needs manual fixes."
echo ""
echo "Next steps:"
echo "  1. Edit the auto-added entry in wrangler.jsonc d1_databases array:"
echo "     - Change binding from \"when2play_${GUILD_NAME}\" to \"DB_${GUILD_ID}\""
echo "     - Add \"migrations_dir\": \"migrations\""
echo "     - database_name and database_id are fine as-is"
echo ""
echo "     Result should look like:"
echo "     {"
echo "       \"binding\": \"DB_${GUILD_ID}\","
echo "       \"database_name\": \"when2play-${GUILD_NAME}\","
echo "       \"database_id\": \"<auto-filled by wrangler>\","
echo "       \"migrations_dir\": \"migrations\""
echo "     }"
echo "  2. Run: npx wrangler d1 migrations apply when2play-${GUILD_NAME} --remote"
echo "  3. Run: npx wrangler deploy"
echo "  4. Run /setchannel in the guild's Discord channel"
