#!/usr/bin/env bash
set -euo pipefail

# Apply migrations to all when2play D1 databases.
# Requires: wrangler CLI, jq

DATABASES=$(npx wrangler d1 list --json | jq -r '.[] | select(.name | startswith("when2play-")) | .name')

if [ -z "$DATABASES" ]; then
    echo "No when2play D1 databases found."
    exit 0
fi

for db in $DATABASES; do
    echo "Migrating: $db"
    npx wrangler d1 migrations apply "$db" --remote
done

echo "All databases migrated."
