#!/usr/bin/env bash
set -euo pipefail

# Simulate Discord bot creating an auth token
# Run: bash scripts/simulate-bot.sh [discord_username]
#
# Bot auth fails closed, so the server needs BOT_API_KEY (copy .dev.vars.example
# to .dev.vars) and this script sends the same key. BOT_API_KEY and GUILD_ID
# default to the value in .dev.vars and the first D1 binding in wrangler.jsonc.

API_URL="${API_URL:-http://localhost:8787}"
USERNAME="${1:-TestUser}"
DISCORD_ID="$(date +%s)$(shuf -i 1000-9999 -n 1)"

BOT_API_KEY="${BOT_API_KEY:-$(sed -n 's/^BOT_API_KEY=//p' .dev.vars 2>/dev/null | head -1)}"
if [ -z "$BOT_API_KEY" ]; then
	echo "BOT_API_KEY is not set. Run: cp .dev.vars.example .dev.vars (then restart make dev), or export BOT_API_KEY." >&2
	exit 1
fi
GUILD_ID="${GUILD_ID:-$(sed 's|//.*||' wrangler.jsonc 2>/dev/null | jq -r '.d1_databases[0].binding // empty' 2>/dev/null | sed 's/^DB_//')}"
if [ -z "$GUILD_ID" ]; then
	echo "GUILD_ID is not set and no DB_<guild_id> binding was found in wrangler.jsonc. Export GUILD_ID." >&2
	exit 1
fi

echo "Creating auth token for user: $USERNAME (discord_id: $DISCORD_ID, guild: $GUILD_ID)"

RESPONSE=$(curl -s -X POST "$API_URL/api/auth/token" \
	-H "Content-Type: application/json" \
	-H "X-Bot-Token: $BOT_API_KEY" \
	-H "X-Guild-Id: $GUILD_ID" \
	-d "{\"discord_id\": \"$DISCORD_ID\", \"discord_username\": \"$USERNAME\", \"avatar_url\": \"https://cdn.discordapp.com/embed/avatars/0.png\"}")

echo "Response: $RESPONSE"

TOKEN=$(echo "$RESPONSE" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

if [ -n "$TOKEN" ]; then
	echo ""
	echo "Open this URL in your browser:"
	echo "  http://localhost:5173/auth/$TOKEN?guild=$GUILD_ID"
	echo ""
	echo "Or directly via backend:"
	echo "  $API_URL/api/auth/callback/$TOKEN?guild=$GUILD_ID"
fi
