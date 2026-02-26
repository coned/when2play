#!/usr/bin/env bash
set -euo pipefail

# Simulate Discord bot creating an auth token
# Run: bash scripts/simulate-bot.sh [discord_username]

API_URL="${API_URL:-http://localhost:8787}"
USERNAME="${1:-TestUser}"
DISCORD_ID="$(date +%s)$(shuf -i 1000-9999 -n 1)"

echo "Creating auth token for user: $USERNAME (discord_id: $DISCORD_ID)"

RESPONSE=$(curl -s -X POST "$API_URL/api/auth/token" \
	-H "Content-Type: application/json" \
	-d "{\"discord_id\": \"$DISCORD_ID\", \"discord_username\": \"$USERNAME\", \"avatar_url\": \"https://cdn.discordapp.com/embed/avatars/0.png\"}")

echo "Response: $RESPONSE"

TOKEN=$(echo "$RESPONSE" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

if [ -n "$TOKEN" ]; then
	echo ""
	echo "Open this URL in your browser:"
	echo "  http://localhost:5173/auth/$TOKEN"
	echo ""
	echo "Or directly via backend:"
	echo "  $API_URL/api/auth/callback/$TOKEN"
fi
