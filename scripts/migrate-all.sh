#!/usr/bin/env bash
set -euo pipefail

# Apply migrations to all when2play D1 databases defined in wrangler.jsonc.
# Requires: wrangler CLI, jq

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG="$SCRIPT_DIR/../wrangler.jsonc"

# Strip comments from jsonc before feeding to jq
DATABASES=$(sed 's|//.*||' "$CONFIG" | jq -r '.d1_databases[].database_name')

if [ -z "$DATABASES" ]; then
    echo "No D1 databases found in wrangler.jsonc."
    exit 0
fi

for db in $DATABASES; do
    echo "Migrating: $db"
    npx wrangler d1 migrations apply "$db" --remote
done

echo "All databases migrated."
