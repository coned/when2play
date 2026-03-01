# Multi-Guild Architecture Design

> Status: Implemented.

This document describes how to evolve when2play from single-guild to multi-guild support using a **single Worker with multiple D1 databases**. Each guild gets its own D1 database for full data isolation, while the bot, Worker, API URL, and API key remain shared.

---

## 1. Overview

```
Discord Gateway (WebSocket)
        |
   bot.mjs (single instance)
        |
        +-- X-Guild-Id: 111... ---+
        +-- X-Guild-Id: 333... ---+--> Single Worker
        +-- X-Guild-Id: 555... ---+        |
                                      guild middleware
                                      resolves DB binding
                                           |
                                    +------+------+
                                    |      |      |
                                  D1_111 D1_333 D1_555
```

One bot, one Worker deployment, one API URL, one `BOT_API_KEY`. Guild isolation happens at the database layer: the Worker holds multiple D1 bindings and a middleware selects the right one per request.

---

## 2. Why this approach

Three options were considered:

| | (A) Single DB + guild_id columns | (B) Separate Worker per guild | (C) Single Worker + multi-D1 |
|---|---|---|---|
| **Isolation** | Row-level (error-prone) | Full stack | DB-level |
| **Schema changes** | Every table needs `guild_id`, composite indexes, scoped queries | None | None |
| **Deployments** | 1 | N Workers, N URLs, N API keys | 1 |
| **Code changes per deploy** | 1 deploy | N deploys | 1 deploy |
| **Rate limits** | Shared | Independent | Shared |
| **Single point of failure** | Yes | No | Yes |
| **Operational complexity** | Low | High | Low |

**Why not (A):** Nearly every table (users, rallies, actions, gather pings, games, votes, schedules) would need a `guild_id` column, composite indexes, and scoped queries. A single bug in guild scoping can leak one group's data to another. Large, error-prone migration.

**Why not (B):** N Workers means N URLs, N API keys, N `wrangler deploy` runs for every code change. The bot needs per-guild routing config. Operational overhead grows linearly with guilds.

**Why (C) wins:** One deployment, one URL, one API key. DB-level isolation with zero changes to any query function -- every query already accepts `db: D1Database` as a parameter. The middleware swaps `c.env.DB` before the request reaches any route, so routes and queries are completely unaware of multi-guild.

**Trade-offs of (C):** All guilds share the same Worker's rate limits and availability. If the Worker goes down, all guilds are affected. For when2play's scale (small friend groups, low traffic), this is acceptable.

---

## 3. Worker-side: Guild DB routing middleware

### D1 binding naming convention

Each guild gets a D1 binding named `DB_<guild_id>` in `wrangler.jsonc`:

```jsonc
"d1_databases": [
	{
		"binding": "DB",
		"database_name": "when2play-db",
		"database_id": "...",
		"migrations_dir": "migrations"
	},
	{
		"binding": "DB_111111111111111111",
		"database_name": "when2play-guild-a",
		"database_id": "...",
		"migrations_dir": "migrations"
	},
	{
		"binding": "DB_333333333333333333",
		"database_name": "when2play-guild-b",
		"database_id": "...",
		"migrations_dir": "migrations"
	}
]
```

The original `DB` binding remains as the default/fallback for the initial guild (backwards-compatible).

All guild databases share the same `migrations/` directory since they use identical schemas.

### Bindings type update (`src/env.ts`)

Add an index signature so the Worker can access guild bindings dynamically:

```typescript
export interface Bindings {
	DB: D1Database;
	BOT_API_KEY?: string;
	[key: `DB_${string}`]: D1Database;
}
```

### Guild middleware (`src/middleware/guild.ts`)

A new middleware resolves the guild ID from the request and overwrites `c.env.DB` with the guild-specific binding:

```typescript
import { createMiddleware } from 'hono/factory';
import { getCookie } from 'hono/cookie';
import type { Bindings } from '../env';

export const guildDb = createMiddleware<{ Bindings: Bindings }>(async (c, next) => {
	// Only trust X-Guild-Id from bot-authenticated requests.
	// Browsers can set arbitrary headers via fetch(), so unauthenticated
	// requests must use the guild_id cookie or guild query param instead.
	const isBotAuth =
		!!c.env.BOT_API_KEY &&
		c.req.header('X-Bot-Token') === c.env.BOT_API_KEY;

	const guildId = isBotAuth
		? c.req.header('X-Guild-Id')
		: (c.req.query('guild') || getCookie(c, 'guild_id'));

	if (!guildId) {
		return c.json({ ok: false, error: { code: 'MISSING_GUILD', message: 'No guild context' } }, 400);
	}

	// Validate format: Discord snowflakes are numeric strings, 17-20 digits.
	if (!/^\d{17,20}$/.test(guildId)) {
		return c.json({ ok: false, error: { code: 'INVALID_GUILD', message: 'Invalid guild ID format' } }, 400);
	}

	const bindingKey = `DB_${guildId}` as const;
	const db = c.env[bindingKey];

	if (!db) {
		// Fall back to default DB if no guild-specific binding exists.
		// This supports the initial single-guild setup where only `DB` is configured.
		// Once all guilds have named bindings, remove this fallback for defense in depth.
		if (c.env.DB) {
			await next();
			return;
		}
		return c.json({ ok: false, error: { code: 'UNKNOWN_GUILD', message: 'No DB binding for guild' } }, 404);
	}

	c.env.DB = db;
	await next();
});
```

**Resolution priority:**
1. `X-Guild-Id` header -- trusted only when the request also carries a valid `X-Bot-Token`
2. `guild` query parameter -- passed through during the auth callback redirect (browser)
3. `guild_id` cookie -- set after auth completes, used by subsequent browser requests

### Wiring into `src/index.ts`

The guild middleware goes on the `/api` sub-router, after CORS/security headers and before `foreignKeys`:

```typescript
// Existing middleware (app-level)
app.use('*', errorHandler);
app.use('*', cors);
app.use('*', securityHeaders);

// API sub-router
const api = new Hono<{ Bindings: Bindings }>();
api.use('*', guildDb);       // <-- new: resolve guild DB
api.use('*', foreignKeys);   // existing: PRAGMA foreign_keys = ON
```

`GET /api/health` should be registered on the `app` router directly (outside the guild-scoped `api` sub-router) so it works without a guild context.

### Effect on routes and queries

**None.** Every route reads `c.env.DB`. Every query function accepts `db: D1Database`. The middleware swaps the binding before any route runs. Zero changes to route handlers or query functions.

---

## 4. Auth flow changes

The auth flow needs to thread guild context through the browser redirect, since the browser has no `X-Guild-Id` header.

### Token generation (`POST /api/auth/token`)

The bot sends `X-Guild-Id` as usual. The generated auth URL includes the guild as a query parameter:

```typescript
const guildId = c.req.header('X-Guild-Id');
const authUrl = `${baseUrl}/auth/${token}${guildId ? `?guild=${guildId}` : ''}`;
return c.json({ ok: true, data: { token, url: authUrl } }, 201);
```

### Frontend redirect (`AuthCallback.tsx`)

The component passes the `guild` query parameter through to the backend callback:

```typescript
useEffect(() => {
	if (!token) { setError('No token provided'); return; }
	const params = new URLSearchParams(window.location.search);
	const guild = params.get('guild');
	const callbackUrl = `/api/auth/callback/${token}${guild ? `?guild=${guild}` : ''}`;
	window.location.href = callbackUrl;
}, [token]);
```

### Auth callback (`GET /api/auth/callback/:token`)

The callback reads `guild` from the query string (the guild middleware already resolved the DB from this param). For browser redirects, it sets a `guild_id` cookie alongside `session_id`:

```typescript
const guildId = c.req.query('guild');
if (guildId) {
	setCookie(c, 'guild_id', guildId, cookieOptions);  // same options as session_id
}
setCookie(c, 'session_id', sessionId, cookieOptions);
return c.redirect('/');
```

`guild_id` must use the same cookie attributes as `session_id`: `httpOnly`, `Secure`, `SameSite=Lax`, `Path=/`. This prevents client-side JavaScript from reading or modifying the guild context.

### Subsequent browser requests

The browser sends both `session_id` and `guild_id` cookies. The guild middleware reads `guild_id` to resolve the DB, then `requireAuth` reads `session_id` to look up the user -- in the correct database.

This avoids a chicken-and-egg problem: you can't look up a session to find the guild if you need the guild to find the database.

---

## 5. Bot-side changes

### Config file evolution

`guild-config.json` evolves from Phase 1's flat format to a per-guild structure:

```json
// Phase 1 (current)
{ "channelId": "222222222222222222" }

// Phase 2 (multi-guild)
{
  "guilds": {
    "111111111111111111": {
      "channelId": "222222222222222222"
    },
    "333333333333333333": {
      "channelId": "444444444444444444"
    }
  }
}
```

Note the difference from the old design: no `apiUrl` or `botApiKey` per guild. There is only one Worker, one URL, one key.

### Auto-migration from flat format

On startup, if the config has the old flat shape, migrate automatically:

```javascript
function loadConfig() {
	const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
	if (raw.channelId && !raw.guilds) {
		// Flat Phase 1 format -- migrate to Phase 2
		const guildId = GUILD_ID; // from env, identifies the original guild
		const migrated = { guilds: { [guildId]: { channelId: raw.channelId } } };
		fs.writeFileSync(CONFIG_PATH, JSON.stringify(migrated, null, 2));
		return migrated;
	}
	return raw;
}
```

### Guild headers helper

A helper adds `X-Guild-Id` to every API request:

```javascript
function buildGuildHeaders(guildId) {
	return {
		'Content-Type': 'application/json',
		...(BOT_API_KEY ? { 'X-Bot-Token': BOT_API_KEY } : {}),
		'X-Guild-Id': guildId,
	};
}
```

### Updated `ensureUser` and `apiCallWithSession`

Both functions gain a `guildId` parameter:

```javascript
async function ensureUser(discordUser, guildMember, guildId) {
	const res = await fetch(`${API_URL}/api/auth/token`, {
		method: 'POST',
		headers: buildGuildHeaders(guildId),
		body: JSON.stringify({ ... }),
	});
	// ...
	const cbRes = await fetch(`${API_URL}/api/auth/callback/${token}`, {
		headers: buildGuildHeaders(guildId),
	});
	return cbJson.data;
}

async function apiCallWithSession(sessionId, path, options = {}, guildId) {
	const res = await fetch(`${API_URL}${path}`, {
		...options,
		headers: {
			'Content-Type': 'application/json',
			'Cookie': `session_id=${sessionId}`,
			'X-Guild-Id': guildId,
			...(options.headers || {}),
		},
	});
	return safeJson(res);
}
```

### `/setchannel` update

Writes under the guild key instead of the top level:

```javascript
cachedConfig.guilds ??= {};
cachedConfig.guilds[interaction.guildId] = {
	...(cachedConfig.guilds[interaction.guildId] || {}),
	channelId: interaction.channelId,
};
saveConfig(cachedConfig);
```

### Polling loop

The polling loop iterates all registered guilds. Error tracking is per-guild:

```javascript
const guildErrors = {}; // { guildId: consecutiveErrorCount }

function scheduleNextPoll() {
	setTimeout(async () => {
		const guilds = Object.entries(cachedConfig.guilds || {});
		await Promise.all(guilds.map(async ([guildId, config]) => {
			try {
				await Promise.all([
					pollGatherPings(guildId, config),
					pollRallyActions(guildId, config),
					pollTreeShares(guildId, config),
				]);
				guildErrors[guildId] = 0;
			} catch {
				guildErrors[guildId] = (guildErrors[guildId] || 0) + 1;
			}
		}));
		scheduleNextPoll();
	}, BASE_POLL_MS);
}
```

Per-guild backoff can be added later if needed, but since all guilds hit the same Worker, a per-guild delay provides limited benefit.

---

## 6. Adding a new guild

Steps to onboard a new guild:

1. **Create the D1 database:**
   ```bash
   wrangler d1 create when2play-<name>
   ```

2. **Add the binding to `wrangler.jsonc`:**
   ```jsonc
   {
     "binding": "DB_<guild_id>",
     "database_name": "when2play-<name>",
     "database_id": "<id from step 1>",
     "migrations_dir": "migrations"
   }
   ```

3. **Apply migrations:**
   ```bash
   wrangler d1 migrations apply when2play-<name> --remote
   ```

4. **Deploy the Worker** (picks up the new binding):
   ```bash
   wrangler deploy
   ```

5. **Run `/setchannel`** in the guild's Discord channel to register the channel mapping in `guild-config.json`.

This can be scripted as `scripts/add-guild.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
GUILD_NAME=$1
GUILD_ID=$2

echo "Creating D1 database: when2play-${GUILD_NAME}"
wrangler d1 create "when2play-${GUILD_NAME}"

echo ""
echo "Next steps:"
echo "  1. Add DB_${GUILD_ID} binding to wrangler.jsonc with the database ID above"
echo "  2. Run: wrangler d1 migrations apply when2play-${GUILD_NAME} --remote"
echo "  3. Run: wrangler deploy"
echo "  4. Run /setchannel in the guild's Discord channel"
```

---

## 7. Migration strategy

### Shared migrations directory

All guild databases use the same schema, so they share a single `migrations/` directory. Each D1 binding in `wrangler.jsonc` points to `"migrations_dir": "migrations"`.

### Applying migrations across all databases

`scripts/migrate-all.sh` iterates all D1 databases and applies migrations:

```bash
#!/usr/bin/env bash
set -euo pipefail

# List all when2play D1 databases
DATABASES=$(wrangler d1 list --json | jq -r '.[] | select(.name | startswith("when2play-")) | .name')

for db in $DATABASES; do
    echo "Migrating: $db"
    wrangler d1 migrations apply "$db" --remote
done

echo "All databases migrated."
```

### Deploy order

1. Run `scripts/migrate-all.sh` to bring all databases to the latest schema
2. Run `wrangler deploy` to deploy the updated Worker

This ensures the Worker never runs against an outdated schema.

---

## 8. Edge cases

### Guild removal

When the bot is removed from a guild:
- Remove the guild entry from `guild-config.json`
- The polling loop stops polling that guild
- The D1 database and Worker binding can remain (data preserved) or be cleaned up manually

### Backend URL changes

Only one URL exists. If it changes (e.g., custom domain):
- Update `WHEN2PLAY_API_URL` in the bot's environment
- Restart the bot

### API key rotation

1. Set the new key in the Worker: `wrangler secret put BOT_API_KEY`
2. Update `BOT_API_KEY` in the bot's environment
3. Restart the bot
4. All guilds use the new key immediately (single key, not per-guild)

### Bot restarts

Config is persisted to `guild-config.json`. On restart, the bot loads the config and resumes polling for all guilds.

### User switching guilds

A user may be in multiple guilds. When they authenticate through a different guild's `/play` link:
- The new auth flow sets a new `guild_id` cookie, overwriting the old one
- Stale browser tabs pointing at the old guild will get 401 on their next API call (session exists in a different DB)
- The user re-authenticates via the new guild's `/play` link

### DM interactions

Some interactions (e.g., bot DMs) have no `guildId`. The bot should skip these or handle them gracefully without making API calls that require a guild context.

---

## 9. Security considerations

### Guild ID source trust boundary

The `X-Guild-Id` header is only trusted when the request also carries a valid `X-Bot-Token`. The guild middleware verifies the bot token itself (a simple string comparison against `c.env.BOT_API_KEY`) before reading the header. This is necessary because browsers can set arbitrary request headers via `fetch()` -- a user in guild A could otherwise craft a request with `X-Guild-Id: <guild_b_id>`.

For browser requests (no valid bot token), guild context comes exclusively from:
- The `guild_id` cookie (httpOnly, set by the server during auth callback)
- The `guild` query parameter (used only during the auth callback redirect)

### Guild ID format validation

Guild IDs are validated as Discord snowflakes (17-20 digit numeric strings) before being used as a dynamic property key (`env["DB_" + guildId]`). This prevents unexpected property lookups on the Worker `env` object from malformed or injected values.

### Cross-guild session isolation

Even if guild context were somehow spoofed, cross-guild data access is prevented by construction:

- **Sessions are per-database.** A session created in guild A's DB does not exist in guild B's DB. If a request is routed to the wrong DB, `requireAuth` fails to find the session and returns 401.
- **Auth tokens are per-database.** A token created by the bot for guild A (stored in guild A's DB) cannot be consumed from guild B's DB. Tampering with the `guild` query param during the auth callback causes the token lookup to fail.
- **The worst case for cookie tampering is self-denial.** If a user modifies their `guild_id` cookie via devtools, their session won't be found in the new DB, and they get 401 until they re-authenticate.

### Cookie integrity

The `guild_id` cookie uses the same attributes as `session_id` (`httpOnly`, `Secure`, `SameSite=Lax`, `Path=/`). `httpOnly` prevents client-side JavaScript from reading the guild context. Users can still modify cookies via browser devtools, but this only results in self-denial (401), not cross-guild access.

### Default DB fallback

During migration from Phase 1, the middleware falls back to the default `DB` binding when no guild-specific binding exists. This is safe because session isolation still applies -- even if an unknown guild ID routes to the default DB, the session won't exist there unless the user legitimately authenticated against it.

Once all guilds have explicit `DB_<guild_id>` bindings, the fallback should be removed for defense in depth. At that point, any request with an unrecognized guild ID should fail with `UNKNOWN_GUILD`.

---

## 10. Migration path from Phase 1

The transition from single-guild to multi-guild is incremental:

1. **Deploy the guild middleware** with fallback behavior: if no guild-specific binding exists, use the default `DB` binding. The existing single-guild setup continues to work with zero config changes.

2. **Update the bot** to send `X-Guild-Id` headers. The original guild uses the default `DB` binding (fallback path). No new D1 databases needed yet.

3. **Add the auth flow changes** (guild query param, guild_id cookie). The original guild's auth flow works as before since the middleware falls back to `DB`.

4. **Onboard the second guild**: create a new D1 database, add the binding, run migrations, deploy, and `/setchannel` in the new guild.

5. **Optionally**, migrate the original guild to a named binding (`DB_<original_guild_id>`) for consistency. The default `DB` binding can remain as a fallback or be removed.

---

## 11. Implementation scope summary

| Area | Change | Scope |
|------|--------|-------|
| **Worker: new file** | `src/middleware/guild.ts` | ~30 lines |
| **Worker: modified** | `src/env.ts` -- add index signature to `Bindings` | 1 line |
| **Worker: modified** | `src/index.ts` -- wire guild middleware | 1 line |
| **Worker: modified** | `src/routes/auth.ts` -- append `?guild=` to auth URL, set `guild_id` cookie | ~10 lines |
| **Frontend: modified** | `AuthCallback.tsx` -- pass `guild` query param through | ~3 lines |
| **Bot: modified** | `bot.mjs` -- guild headers, config migration, per-guild polling | ~100 lines |
| **Config: modified** | `wrangler.jsonc` -- additional D1 bindings per guild | Per guild |
| **New scripts** | `scripts/add-guild.sh`, `scripts/migrate-all.sh` | ~20 lines each |
| **Query functions** | No changes | 0 lines |
| **Route handlers** | No changes (except auth) | 0 lines |
