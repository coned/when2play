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

(`make release APP_URL=...` also works: it migrates every database in `wrangler.jsonc`, including the new one, then deploys and smoke tests.)

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

### Numbering new migrations

`0000_init.sql` is a consolidation of the original migrations `0000` to `0007`. Production databases still record those original file names in `d1_migrations`, so wrangler treats `0000_init.sql` as already applied and never re-runs it there. Every schema change must therefore go into a new file numbered `0008` or higher (the next one after the highest existing file), written idempotently (`IF NOT EXISTS`) so it is also safe on fresh databases. Editing `0000_init.sql` only affects fresh databases and tests.

### Deploy order

1. Migrations: `make migrate-remote` (every database in `wrangler.jsonc`) brings all databases to the latest schema
2. Worker: `make deploy`
3. Bot: `make deploy` in `when2play_discordbot` (only when the bot changed)

This ensures the Worker never runs against an outdated schema and the bot never calls endpoints the Worker does not have yet. `make release` (below) does steps 1 and 2 in that order.

---

## Releasing an Update

```bash
make release APP_URL=https://when2play.<your-subdomain>.workers.dev
# then, if the bot changed:
cd ../when2play_discordbot && make deploy
```

`make release` runs, in order, and stops at the first failure:

| Step | Target | What it does |
|------|--------|--------------|
| 0 | `require-app-url` | Fails right away (before touching anything) when `APP_URL` is empty |
| 1 | `check` | `npm run typecheck` (Worker and frontend), then `npx vitest run` |
| 2 | `build` | `vite build` into `frontend/dist` (includes `frontend/public/_headers`) |
| 3 | `migrate-remote` | `wrangler d1 migrations apply <db> --remote` for every database in `wrangler.jsonc`; stops on the first failing database |
| 4 | deploy | `npx wrangler deploy --var GIT_SHA:<short commit>[-dirty]` |
| 5 | `smoke` | Fetches `$APP_URL/api/health` (retries for about 30 s while the new version propagates) and fails unless `ok` is true and `version` equals the local commit |

Commit before releasing: a deploy from a tree with uncommitted changes (untracked files count) is stamped `<commit>-dirty`, which tells you later that the live code is not exactly that commit.

`APP_URL` is the Worker's public base URL (custom domain or `*.workers.dev`). There is no default in the repo: pass it on the command line or `export APP_URL=...` in your shell profile.

Other entry points:

| Command | Use |
|---------|-----|
| `make deploy` | `check`, `build`, deploy (no migrations, no smoke test) |
| `make deploy-only` | Deploy as is, skipping checks and build. Escape hatch for emergencies; still stamps `GIT_SHA` |
| `make smoke APP_URL=...` | Re-run the post-deploy check at any time |
| `make check` | What CI runs before the build: type check, then tests |

### Which commit is live?

```bash
curl -s https://when2play.<your-subdomain>.workers.dev/api/health
# {"ok":true,"data":{"status":"healthy","version":"1b4798c","timestamp":"..."}}
make version   # what a deploy from your tree would report
```

`version` is `dev` when the Worker was deployed without `GIT_SHA` (a bare `npx wrangler deploy`), and ends in `-dirty` when it was deployed from uncommitted changes.

### CI

`.github/workflows/ci.yml` runs on pull requests and pushes to `master`: `npm ci`, `npm run typecheck`, `npx vitest run`, `npm run build` on Node 22. It needs no `wrangler.jsonc` and no secrets, and it does not deploy. The bot branch (`discordbot`) has its own workflow running `npm ci` and `npm test`.

---

## API Key Rotation

Both the bot and server share one secret: `BOT_API_KEY`.

1. Generate a new key: `openssl rand -hex 32`
2. Set the new key on the Worker: `npx wrangler secret put BOT_API_KEY`
3. Update `BOT_API_KEY` in the bot's `.env` file
4. Restart the bot

All guilds use the new key immediately (single key, not per-guild). Between steps 2 and 4 the bot gets `403` from every bot endpoint. Never delete the secret to "disable" it: bot auth fails closed, so without the secret every bot endpoint answers `503 BOT_AUTH_NOT_CONFIGURED`.

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
- `BOT_API_KEY` in `.env` doesn't match the secret set in the Worker (`npx wrangler secret put BOT_API_KEY`): HTTP 403 `FORBIDDEN`
- The Worker has no `BOT_API_KEY` secret at all (for example a new environment): HTTP 503 `BOT_AUTH_NOT_CONFIGURED`
- The Worker is not deployed or is unhealthy (`curl $WHEN2PLAY_API_URL/api/health`)

---

## Quick Reference

| What | Command |
|------|---------|
| Install | `npm install` |
| Dev server | `make dev` |
| Build frontend | `make build` |
| Run tests | `make test` |
| Type check | `make typecheck` |
| Type check + tests | `make check` |
| Release (check, build, migrate, deploy, smoke) | `make release APP_URL=https://...` |
| Deploy (check, build, deploy) | `make deploy` |
| Deploy without checks or build | `make deploy-only` |
| Which commit is live | `make smoke APP_URL=https://...` or `curl $APP_URL/api/health` |
| Apply remote migrations | `make migrate-remote` |
| Apply local migrations | `make migrate-local` |
| Set bot secret | `npx wrangler secret put BOT_API_KEY` |
| Stream logs | `make logs` |
| Simulate auth | `make simulate` |
| Seed data | `make seed` |
| Query remote D1 | `npx wrangler d1 execute when2play-<guild-name> --remote --command "SELECT ..."` |
