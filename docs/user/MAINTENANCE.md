# Maintenance

Ongoing operations: adding guilds, running migrations, deploying updates, and handling common tasks.

---

## Adding a New Discord Guild

Each guild gets its own isolated D1 database. To onboard a new guild:

### 1. Create the D1 database

```bash
npx wrangler d1 create when2play-<guild-name>
```

Or use the helper script (validates the guild ID format and prints next steps):

```bash
scripts/add-guild.sh <guild-name> <guild-id>
```

Wrangler auto-adds an entry to the `d1_databases` array in `wrangler.jsonc`, but **it needs manual fixes** (see step 2).

### 2. Fix the auto-added binding in `wrangler.jsonc`

> `wrangler.jsonc` is gitignored (it contains guild-specific IDs). Edit your local copy directly.

Wrangler generates the binding name from the database name and omits `migrations_dir`. You must fix both:

- Change `binding` from `"when2play_<name>"` to `"DB_<guild_id>"` (the Worker looks up databases by guild snowflake at runtime).
- Add `"migrations_dir": "migrations"` (required for `wrangler d1 migrations apply`).
- `database_name` and `database_id` are fine as-is.

The corrected entry should look like:

```jsonc
{
    "binding": "DB_<guild_id>",
    "database_name": "when2play-<guild-name>",
    "database_id": "<auto-filled by wrangler>",
    "migrations_dir": "migrations"
}
```

### 3. Apply migrations

```bash
npx wrangler d1 migrations apply when2play-<guild-name> --remote
```

### 4. Deploy the Worker (picks up the new binding)

```bash
make deploy
```

### 5. Configure the bot channel

In the new guild's Discord channel, run `/setchannel` (requires ADMINISTRATOR).

### 6. Invite the bot

If the bot hasn't been invited to the new guild yet, use the OAuth2 URL from the Discord Developer Portal (same URL used during initial setup).

The bot automatically detects new guilds on startup and begins polling for them. If the bot is already running, it will pick up the new guild on its next `client.guilds.cache` refresh (usually within seconds of being invited).

---

## Applying Migrations

### Single database

```bash
npx wrangler d1 migrations apply when2play-<guild-name> --remote
```

### All databases at once

```bash
scripts/migrate-all.sh
```

This iterates all when2play D1 databases and applies pending migrations. All guild databases share the same `migrations/` directory since they use identical schemas.

### Deploy order

1. Run `scripts/migrate-all.sh` to bring all databases to the latest schema
2. Run `make deploy` to deploy the updated Worker

This ensures the Worker never runs against an outdated schema.

---

## Subsequent Deploys

```bash
# If new migrations exist:
make migrate-remote
# or: scripts/migrate-all.sh (for all guilds)

# Deploy:
make deploy
```

---

## API Key Rotation

Both the bot and server share one secret: `BOT_API_KEY`.

1. Generate a new key: `openssl rand -hex 32`
2. Set the new key on the Worker: `npx wrangler secret put BOT_API_KEY`
3. Update `BOT_API_KEY` in the bot's `.env` file
4. Restart the bot

All guilds use the new key immediately (single key, not per-guild).

---

## Bot Restarts

On startup, the bot fetches settings from D1 (`GET /api/settings/bot`) for each guild in `client.guilds.cache` and resumes polling. Channel configuration is stored in D1, so no local state is lost on restart.

---

## Guild Removal

When the bot is removed from a guild:
- The guild disappears from `client.guilds.cache`, so polling stops automatically
- The D1 database and Worker binding can remain (data preserved) or be cleaned up manually

---

## Backend URL Changes

If the Worker URL changes (e.g., switching to a custom domain):

1. Update `WHEN2PLAY_API_URL` in the bot's `.env` file
2. Restart the bot

---

## Troubleshooting

### `ConnectTimeoutError` when the bot polls or handles `/when2play`

```
Error polling gather pings: TypeError: fetch failed
  [cause]: ConnectTimeoutError (attempted addresses: 172.67.x.x:443, timeout: 10000ms)
```

This is a transient network issue on the bot's host, not a bug. The bot recovers automatically on the next poll cycle (15 seconds). If it happens frequently, check:

- Whether the host's network has intermittent connectivity
- Whether a firewall is blocking outbound HTTPS
- Whether the `WHEN2PLAY_API_URL` is correct and the Worker is deployed

### `Missing required env vars` on bot startup

Either `DISCORD_TOKEN` or `WHEN2PLAY_API_URL` is missing from `.env`. Check that the file exists and is being loaded (`--env-file=.env`).

### Slash commands not appearing in Discord

Commands are registered on bot startup via `registerCommands()`. This requires the bot to connect successfully at least once. If commands still don't appear after a minute, check the console for errors during startup.

### `Failed: ...` reply to `/when2play`

The Worker returned an error from `POST /api/auth/token`. Common causes:
- `BOT_API_KEY` in `.env` doesn't match the secret set in the Worker (`npx wrangler secret put BOT_API_KEY`)
- The Worker is not deployed or is unhealthy (`curl $WHEN2PLAY_API_URL/api/health`)

---

## Quick Reference

| What | Command |
|------|---------|
| Install | `npm install` |
| Dev server | `make dev` |
| Build frontend | `make build` |
| Run tests | `make test` |
| Deploy | `make deploy` |
| Apply remote migrations | `make migrate-remote` |
| Apply local migrations | `make migrate-local` |
| Set bot secret | `npx wrangler secret put BOT_API_KEY` |
| Stream logs | `make logs` |
| Simulate auth | `make simulate` |
| Seed data | `make seed` |
| Query remote D1 | `npx wrangler d1 execute when2play-<guild-name> --remote --command "SELECT ..."` |
