# when2play — API Reference

Base URL: `/api`

All responses follow the format:

```json
// Success
{ "ok": true, "data": { ... } }

// Error
{ "ok": false, "error": { "code": "ERROR_CODE", "message": "Description" } }
```

Unhandled error messages are redacted by default. Set `VERBOSE_ERRORS=1` (env var / wrangler secret) to include the original error message in the response.

## Authentication

Endpoints marked "requires session cookie" (user routes) accept either of:

- **Session cookie** `session_id=...` (browser, or the legacy bot flow through `/api/auth/token` + `/api/auth/callback/:token`).
- **Bot acting as a user:** headers `X-Bot-Token: <BOT_API_KEY>`, `X-Guild-Id: <guild id>` and `X-Discord-User-Id: <discord id>`. The request is authenticated as the user with that `discord_id` in the guild's database (create or refresh them first with `POST /api/users/sync`). Unknown `discord_id` gives `401 UNAUTHORIZED`. Such requests are never admin (`is_admin: false`) and have no session (`POST /api/auth/logout` is a no-op for them). This path only exists when the `BOT_API_KEY` secret is set; with a missing or wrong `X-Bot-Token` the `X-Discord-User-Id` header is ignored and the request needs a cookie like any other.

Bot-auth endpoints take `X-Bot-Token` only (when `BOT_API_KEY` is unset they are open, for local dev only).

## Rate limits for posts to Discord

Every request that queues a post to Discord is limited per user, using the admin settings `gather_cooldown_seconds` (default 10) and `gather_hourly_limit` (default 30). A value of `0` disables that check.

- **Cooldown:** the same user repeating the same rally `action_type` (`call`, `in`, `out`, `brb`, `ping`, `where`, `judge_time`, `judge_avail`, `share_ranking`) within the cooldown. Also applies to `POST /api/games/:id/share` (any game) and `POST /api/rally/tree/share`, each as its own kind.
- **Hourly limit:** a user with that many rally actions (all types) in the last 60 minutes.

Both answer `429` with `{ "ok": false, "error": { "code": "RATE_LIMITED", "message": "Cooldown active. Try again in 7s" } }` (or `"Hourly limit reached. Try again in 1234s"`). The message always ends with the remaining seconds.

## Delivery state

`rally_actions`, `rally_tree_shares` and `game_shares` share a `delivered` column: `0` pending, `1` delivered (acknowledged by the bot), `2` expired (dropped unsent after 30 minutes by `POST /api/bot/poll`). Rows expired before this state existed carry `1`. JSON responses expose `delivered: boolean`, which is `true` only for `1`.

---

## Health

### `GET /api/health`
No auth required.

**Response:**
```json
{ "ok": true, "data": { "status": "healthy", "timestamp": "2026-02-26T00:00:00.000Z" } }
```

---

## Bot Delivery Poll

### `POST /api/bot/poll` (Bot-auth, recommended)
One request per bot polling cycle for **all** guilds: acknowledges what the bot delivered since the last cycle and returns every rally action, tree share and game share still waiting to be posted. Replaces the per-guild, per-kind `GET .../pending` and `PATCH .../delivered` calls (now legacy). Gather pings are not covered; they keep using `/api/gather/pending`.

**Auth:** `X-Bot-Token` header (required when `BOT_API_KEY` secret is set). **No `X-Guild-Id`** and no `?guild=`: the endpoint is cross-guild and reads each guild's `DB_<guild_id>` binding itself.

**Body:**
```json
{
  "guild_ids": ["926950608127287346", "1165751530654273707"],
  "acks": {
    "926950608127287346": {
      "rally_actions": ["action-uuid"],
      "tree_shares": ["tree-share-uuid"],
      "game_shares": ["game-share-uuid"]
    }
  }
}
```

- `guild_ids` (required): array of guild ID strings matching `/^\d{17,20}$/`. Duplicates are ignored; at most 100 distinct IDs. An empty array is allowed (acks only).
- `acks` (optional): object keyed by guild ID (same format, at most 100 keys). Each value is an object with any of `rally_actions`, `tree_shares`, `game_shares` (no other keys); each list holds at most 200 non-empty ID strings of at most 100 characters. Acked IDs are marked delivered; unknown or already-delivered IDs are ignored, so re-sending an ack is harmless. Acks are applied for every guild that has a DB binding, even if it is not listed in `guild_ids` (such a guild is acked but not polled).
- Anything else returns `400 BAD_REQUEST`.

**Per guild, in order:** apply acks; count undelivered rows and read the stored heartbeat with one query; write the heartbeat if it is due; idle guilds stop here and are omitted from the response; mark rows older than 30 minutes as expired (`delivered = 2`); return the remaining undelivered rows of each kind, oldest first.

**Staleness rule:** items older than 30 minutes (`PENDING_MAX_AGE_MS`) are never returned. They are marked expired (`delivered = 2`) so a bot coming back from an outage never posts a stale backlog. The legacy pending endpoints apply the same 30 minute filter (read-only).

**Heartbeat:** every guild listed in `guild_ids` (not ack-only guilds) gets its poll time stored in its `settings` table under `bot_last_poll_at` (ISO string), rewritten at most once per 60 seconds. `GET /api/rally/active` and the share endpoints report the bot as online when this is less than 3 minutes old. The key is internal: `GET`/`PATCH /api/settings` hide and ignore it.

**Acks and expiry of tree shares** also set `image_data = NULL`: the PNG is only kept until the share is finished.

**Anonymous actions:** for an action with `metadata.is_anonymous: true` the actor fields are replaced: `actor_id: "__anonymous__"`, `actor_username: "Anonymous"`, `actor_avatar: null`, `actor_discord_id: null`.

**Response (200):**
```json
{
  "ok": true,
  "data": {
    "guilds": {
      "926950608127287346": {
        "rally_actions": [{ "id": "action-uuid", "action_type": "call", "actor_discord_id": "...", "actor_username": "GamerDave", "target_user_ids": null, "target_discord_ids": null, "metadata": null, "delivered": false, "...": "..." }],
        "tree_shares": [],
        "game_shares": []
      }
    },
    "unknown_guilds": ["1165751530654273707"],
    "errors": {}
  }
}
```

- `guilds`: only guilds with at least one item to deliver (`{}` when everything is idle). Each present guild has all three arrays (possibly empty). Item shapes are identical to the legacy `GET /api/rally/pending`, `GET /api/rally/tree/share/pending` and `GET /api/games/share/pending` responses.
- `unknown_guilds`: requested or acked guild IDs with no DB binding (always present, possibly `[]`).
- `errors`: guild ID to short error message for guilds that failed twice (each guild is retried once). Those guilds are missing from `guilds`, and their acks may not have been applied: re-send them next cycle. Always present, possibly `{}`. The HTTP status stays 200.

---

## Auth

### `POST /api/auth/token`
Creates a one-time auth token for a Discord user. Called by the Discord bot.

**Auth:** `X-Bot-Token` header (required when `BOT_API_KEY` secret is set)

**Body (Zod validated):**
```json
{
  "discord_id": "123456789",        // 1-30 chars, required
  "discord_username": "GamerDave",  // 1-50 chars, required
  "avatar_url": "https://cdn.discordapp.com/...",  // max 500 chars, optional
  "guild_name": "My Server"        // max 100 chars, optional (saved to settings)
}
```

**Response (201):**
```json
{ "ok": true, "data": { "token": "abc123...", "url": "https://host/auth/abc123..." } }
```

Each call (and each `/api/auth/admin-token` call) first deletes used or expired auth tokens and expired sessions, in one batch.

The bot should prefer `POST /api/users/sync` plus the act-as headers (see Authentication) over minting tokens and sessions. This endpoint and the bot branch of the callback keep working.

### `POST /api/auth/admin-token`
Creates a one-time admin auth token. Called by the Discord bot after verifying the requesting member has `ADMINISTRATOR` permission. The resulting session grants admin privileges.

**Auth:** `X-Bot-Token` header (required when `BOT_API_KEY` secret is set)

**Body:** same schema as `/api/auth/token`

**Response (201):**
```json
{ "ok": true, "data": { "token": "abc123...", "url": "https://host/auth/abc123..." } }
```

### `GET /api/auth/callback/:token`
Exchanges a one-time token for a session cookie. Redirects to `/`.

- **Regular token:** `Set-Cookie: session_id=...; Max-Age=604800; HttpOnly; SameSite=Strict; Path=/` (7-day persistent)
- **Admin token:** `Set-Cookie: session_id=...; HttpOnly; SameSite=Strict; Path=/` (no `Max-Age` — browser-session only; DB row expires after 1 hour)

**Response:** `302 Found`

### `POST /api/auth/logout`
Requires session cookie. Destroys the session.

**Response:**
```json
{ "ok": true, "data": null }
```

---

## Users

All endpoints require session cookie, except `POST /api/users/sync` (bot-auth).

### `POST /api/users/sync` (Bot-auth)
Creates or updates Discord users in the guild named by `X-Guild-Id`, so the bot can then act as them. Creates no auth token and no session.

**Auth:** `X-Bot-Token` + `X-Guild-Id` headers.

**Body (Zod validated):**
```json
{
  "users": [
    { "discord_id": "123456789", "discord_username": "GamerDave", "avatar_url": "https://cdn.discordapp.com/..." }
  ],
  "guild_name": "My Server"
}
```

- `users`: 1 to 10 entries. `discord_id` 1-30 chars, `discord_username` 1-50 chars, `avatar_url` optional, max 500 chars (`null` or absent keeps the stored avatar). Same rules as `POST /api/auth/token`.
- `guild_name`: optional, max 100 chars, saved to settings like `/api/auth/token` does.
- Each user goes through the same upsert as `/api/auth/token` (`display_name` follows `discord_username` while `sync_name_from_discord` is on).

**Response (200):** rows in request order (a repeated `discord_id` appears twice).
```json
{
  "ok": true,
  "data": {
    "users": [
      { "id": "uuid", "discord_id": "123456789", "discord_username": "GamerDave", "display_name": "GamerDave", "avatar_url": "https://..." }
    ]
  }
}
```

**Errors:** `400 BAD_REQUEST` for an invalid body (including 0 or more than 10 users), `403 FORBIDDEN` for a wrong `X-Bot-Token`.

### `GET /api/users`
Returns all registered users (for user pickers in gather/shame).

**Response:**
```json
{
  "ok": true,
  "data": [
    { "id": "uuid", "discord_username": "GamerDave", "avatar_url": "https://..." }
  ]
}
```

### `GET /api/users/me`
Returns the current authenticated user. Includes `is_admin: boolean`: `true` when the session was created via an admin token, always `false` for a bot acting as a user.

### `PATCH /api/users/me`
Updates the current user's profile.

**Body (all fields optional):**
```json
{
  "discord_username": "NewName",
  "display_name": "Dave",
  "sync_name_from_discord": true,
  "timezone": "America/New_York",
  "time_granularity_minutes": 30
}
```

`display_name` overrides the Discord username for display purposes (max 50 chars). `sync_name_from_discord` controls whether the name auto-updates on next login (default `true`).

---

## Games

User-auth endpoints require session cookie. Bot-auth endpoints require `X-Bot-Token` header.

### `GET /api/games`
Lists games with pool filtering, reaction counts, user reactions, and per-user reaction avatars.

**Query params:** `?pool=active|archive|all` (default `active`). Legacy `?include_archived=true` is supported (maps to `all`).

On active/all pool fetch, stale games are auto-archived in the background if `auto_archive_enabled` is true (based on `game_pool_lifespan_days`, default 7).

**Response per game:**
```json
{
  "id": "uuid", "name": "...", "steam_app_id": "730", "image_url": "...",
  "proposed_by": "uuid", "is_archived": false, "note": "optional note",
  "last_activity_at": "2026-03-10T...",
  "like_count": 3, "dislike_count": 1,
  "user_reaction": "like",
  "reaction_users": [
    { "user_id": "uuid", "type": "like", "display_name": "Alice", "avatar_url": "..." }
  ]
}
```

### `POST /api/games`
Proposes a new game. Duplicate detection by `steam_app_id` (returns 409 with `DUPLICATE_GAME` or `ARCHIVED_DUPLICATE`). Steam header image auto-upgraded when `steam_app_id` is provided.

**Body:**
```json
{
  "name": "Counter-Strike 2",     // required, max 100 chars
  "steam_app_id": "730",          // optional
  "image_url": "https://...",     // optional, max 500 chars
  "note": "Great FPS"             // optional, max 500 chars
}
```

### `PATCH /api/games/:id`
Updates a game. Only the proposer can update. Accepts `name`, `image_url`, `note` (max 500 chars).

### `DELETE /api/games/:id`
Archives a game (soft delete). Any user can archive. Accepts optional body `{ "reason": "not_interested" }`.

### `DELETE /api/games/:id/permanent`
Permanently deletes an archived game and all related data (reactions, activity, shares). Only the proposer can permanently delete. Game must be archived first (returns 400 otherwise).

### `POST /api/games/:id/restore`
Restores an archived game to the active pool. Any user can restore. Resets `last_activity_at` to now.

### `PUT /api/games/:id/react`
Sets a reaction (like or dislike) on a game. Updates `last_activity_at`.

**Body:**
```json
{ "type": "like" }
```

### `DELETE /api/games/:id/react`
Removes the current user's reaction from a game.

### `GET /api/games/activity`
Returns recent game activity (propose, like, dislike, archive, restore, share events). Paginated.

**Query params:** `?limit=20&before=<iso-timestamp>` (max 50 per page, cursor-based).

### `POST /api/games/:id/share`
Broadcasts a game to the Discord channel. Creates a share record for bot polling. Logs activity and updates `last_activity_at`. Cooldown per user (see Rate limits): `429 RATE_LIMITED`.

**Response (201):**
```json
{ "ok": true, "data": { "id": "uuid", "game_id": "uuid", "requested_by": "uuid", "delivered": false, "created_at": "...", "bot_online": true } }
```

`bot_online` is `false` when the bot has not polled this guild in the last 3 minutes (bot offline or no output channel): the share stays queued and is dropped after 30 minutes.

### `GET /api/games/share/pending` (Bot-auth, legacy)
Returns undelivered game shares with joined game data (name, note, image, Steam app ID, like/dislike counts, requester name). Shares older than 30 minutes are skipped. Legacy: prefer `POST /api/bot/poll`.

**Auth:** `X-Bot-Token` header

### `PATCH /api/games/share/:id/delivered` (Bot-auth, legacy)
Marks a game share as delivered. Legacy: prefer acks in `POST /api/bot/poll`.

**Auth:** `X-Bot-Token` header

---

## Votes

All endpoints require session cookie.

### `PUT /api/games/:id/vote`
Sets or updates a vote for a game.

**Body:**
```json
{
  "rank": 1,
  "is_approved": true  // optional, defaults to true
}
```

### `DELETE /api/games/:id/vote`
Removes a vote.

### `GET /api/games/:id/votes`
Returns all votes for a specific game. **Note:** `user_id` is stripped from the response for privacy.

### `GET /api/games/ranking`
Returns aggregated Borda count ranking of all active games.

### `GET /api/games/my-votes`
Returns the current user's votes with game data (name, image_url), ordered by rank.

### `PUT /api/games/reorder-votes`
Bulk updates vote ranks after drag-to-reorder.

**Body:**
```json
{
  "rankings": [
    { "game_id": "uuid-1", "rank": 1 },
    { "game_id": "uuid-2", "rank": 2 }
  ]
}
```

---

## Steam

### `GET /api/steam/search?q=QUERY`
Requires session cookie. Searches Steam by partial game name.

**Query:** `q` — 2-100 characters

**Response:**
```json
{
  "ok": true,
  "data": [
    { "app_id": "730", "name": "Counter-Strike 2", "image_url": "https://..." }
  ]
}
```

Returns up to 10 results.

### `GET /api/steam/lookup/:appId`
Looks up a Steam game by App ID. No auth required.

**Response:**
```json
{
  "ok": true,
  "data": {
    "name": "Counter-Strike 2",
    "header_image": "https://cdn.akamai.steamstatic.com/steam/apps/730/header.jpg"
  }
}
```

---

## Availability

All endpoints require session cookie.

### `GET /api/availability`
Query params: `?user_id=...&date=YYYY-MM-DD` (both optional).

Returns slots with per-slot `slot_status` field (`'available'` or `'tentative'`) when available.

**Note:** `user_id` is scoped to the authenticated user when no `date` filter is provided (prevents cross-user personal data access).

### `PUT /api/availability`
Bulk-replaces all availability slots for a given date.

**Body:**
```json
{
  "date": "2026-03-01",
  "slots": [
    { "start_time": "19:00", "end_time": "19:15", "slot_status": "available" },
    { "start_time": "19:15", "end_time": "19:30", "slot_status": "tentative" }
  ]
}
```

`slot_status` defaults to `'available'` if omitted. Upserts an `availability_status` record for the user+date.

The delete and all inserts run as one atomic D1 batch. Returns 400 `BAD_REQUEST` when the body is not valid JSON, `date` is not a real `YYYY-MM-DD` date, `slots` is not an array or has more than 96 entries, a `start_time`/`end_time` is not `HH:MM` (00:00 to 23:59), or `slot_status` is present and not `available`/`tentative`. Duplicate `start_time` values are collapsed (the last one wins).

### `DELETE /api/availability?date=YYYY-MM-DD`
Clears all slots for the given date. `date` is validated like `PUT` (400 on an invalid date). Writes `status = 'filled'` to block auto-seed re-triggering.

### `GET /api/availability/my-status`
Returns the user's availability status for a date range.

**Query params:** `?from=YYYY-MM-DD&to=YYYY-MM-DD` (both required, max 31-day range). Dates are validated with calendar round-trip checks.

**Response:**
```json
{
  "ok": true,
  "data": {
    "2026-03-10": "filled",
    "2026-03-11": "tentative_auto",
    "2026-03-12": null
  }
}
```

### `POST /api/availability/:date/confirm`
Confirms auto-filled availability for a date. Transitions status from `tentative_auto` to `tentative_confirmed`. Date is validated with calendar round-trip check. When the user has no slots for the date, last week's slots are copied in one atomic batch.

**Response:**
```json
{ "ok": true, "data": null }
```

### `POST /api/availability/seed`
Seeds a future date with slots from the same weekday 7 days ago. Idempotent: returns `null` if already seeded, slots exist, or no prior-week data.

**Body:**
```json
{ "date": "2026-03-15" }
```

---

## Gather

### `POST /api/gather`
Requires session cookie. Rings the gather bell. Two independent rate limits apply:

- **Per-ping cooldown** (Check B): `gather_cooldown_seconds` setting (default 10s). Must wait this long between pings.
- **Hourly limit** (Check A, checked first): `gather_hourly_limit` setting (default 30). If ≥ 30 pings in the last 60 minutes, locked out until the oldest ping ages out. Set to 0 to disable either limit.

Both return `429` with `{ error: { code: "RATE_LIMITED", message: "... Try again in Xs" } }`.

**Body (all fields optional):**
```json
{
  "message": "CS2 anyone?",        // max 500 chars
  "is_anonymous": false,            // hide sender identity
  "target_user_ids": ["uuid-1"]    // null = everyone, max 20 users
}
```

### `GET /api/gather/pending`
Returns undelivered gather pings.

**Auth:** `X-Bot-Token` header (required when `BOT_API_KEY` secret is set)

**Response:**
```json
{
  "ok": true,
  "data": [
    {
      "id": "ping-uuid",
      "user_id": "user-uuid",
      "sender_discord_id": "123456789012345678",
      "sender_username": "GamerDave",
      "message": "CS2 anyone?",
      "delivered": false,
      "is_anonymous": false,
      "target_user_ids": null,
      "target_discord_ids": null,
      "created_at": "2026-02-26T19:00:00.000Z"
    }
  ]
}
```

`sender_discord_id` and `target_discord_ids` are pre-resolved numeric Discord IDs — use `<@id>` syntax directly. No bot-side ID mapping needed.

### `PATCH /api/gather/:id/delivered`
Marks a gather ping as delivered.

**Auth:** `X-Bot-Token` header (required when `BOT_API_KEY` secret is set)

---

## Shame

All endpoints require session cookie.

### `POST /api/shame/:targetId`
Shames another user. One shame per voter-target pair per day.

**Body:**
```json
{
  "reason": "No-showed last night",  // optional, max 200 chars
  "is_anonymous": false              // optional, default false
}
```

### `DELETE /api/shame/:targetId`
Withdraws today's shame vote against a user.

### `GET /api/shame/my-votes`
Returns an array of target user IDs the current user has shamed today.

### `GET /api/shame/leaderboard`
Returns the shame leaderboard sorted by weekly shame count. Votes older than 7 days are automatically cleaned up. Each entry includes the latest 3 reasons and today's voters.

**Response:**
```json
{
  "ok": true,
  "data": [
    {
      "user_id": "uuid",
      "discord_username": "GamerDave",
      "avatar_url": "https://...",
      "shame_count_today": 1,
      "shame_count_week": 3,
      "recent_reasons": [
        {
          "reason": "No-showed last night",
          "voter_id": "uuid-or-null",
          "voter_name": "Alice-or-null",
          "voter_avatar": "url-or-null"
        }
      ],
      "today_voters": [
        { "voter_id": "uuid-or-null", "voter_name": "Alice-or-null", "voter_avatar": "url-or-null", "is_anonymous": false }
      ]
    }
  ]
}
```

`voter_id`, `voter_name`, and `voter_avatar` are `null` for anonymous votes.

---

## Rally

All POST bodies must be JSON objects (an empty body counts as `{}` where every field is optional); anything else is `400 BAD_REQUEST`. Every POST that creates an action is rate limited (see Rate limits, `429 RATE_LIMITED`).

**Anonymous actions.** `is_anonymous: true` is only accepted for action types enabled in the admin setting `rally_anonymous_enabled` (default `{"call": true, "ping": true}`); otherwise `400 BAD_REQUEST`, so nobody believes they posted anonymously when they did not. A non-boolean `is_anonymous` is also `400`. In every response (including the creator's own response and the bot payloads) an anonymous action reports `actor_id: "__anonymous__"`, `actor_username: "Anonymous"`, `actor_avatar: null`, `actor_discord_id: null`, and keeps `metadata.is_anonymous: true`. Rallies never include `creator_id`.

### `POST /api/rally/call`
Requires session cookie. Creates or gets today's rally and records a `call` action.

**Body (all fields optional):**
```json
{
  "message": "anyone?",   // max 500 chars
  "is_anonymous": false    // see Anonymous actions
}
```

**Response (201):**
```json
{
  "ok": true,
  "data": {
    "rally": { "id": "uuid", "timing": "now", "day_key": "2026-02-26", "status": "open", "created_at": "..." },
    "action": { "id": "uuid", "rally_id": "uuid", "actor_id": "uuid", "action_type": "call", ... }
  }
}
```

### `POST /api/rally/action`
Requires session cookie. Records an action (in/out/ping/brb/where). Auto-attaches to today's active rally.

**Body:**
```json
{
  "action_type": "in",               // required: "in", "out", "ping", "brb", "where"
  "target_user_ids": ["uuid"],       // required for ping/where: 1-20 ids of existing users
  "rally_id": "uuid",                // optional, must exist; defaults to today's active rally
  "message": "on my way",            // optional, max 500 chars
  "is_anonymous": false              // optional, see Anonymous actions
}
```

`target_user_ids`, when present for any type, must be an array of 1 to 20 user id strings that all exist (`400` otherwise).

### `POST /api/rally/judge/time`
Requires session cookie. Computes all overlapping availability windows for today where 2+ users are available simultaneously.

**Response (201):**
```json
{
  "ok": true,
  "data": {
    "metadata": {
      "windows": [
        { "start": "19:00", "end": "21:00", "user_count": 3, "user_ids": ["..."], "user_names": ["Alice", "Bob", "Dave"] }
      ],
      "day_key": "2026-02-26"
    }
  }
}
```

`start`/`end` are UTC `HH:MM` strings. Times are ordered within the gaming day (from the grid origin `avail_start_hour_et`, so `00:00` UTC comes after `23:45` UTC). Windows are sorted by `user_count` descending, then chronologically within the gaming day. Adjacent windows with the same user set are merged, including across UTC midnight.

### `POST /api/rally/judge/avail`
Requires session cookie. Nudges a user to set availability.

**Body:**
```json
{ "target_user_ids": ["uuid"], "message": "pick your times" }
```

`target_user_ids`: 1-20 ids of existing users; `message` optional, max 500 chars.

### `POST /api/rally/share-ranking`
Requires session cookie. Broadcasts the current game ranking to Discord via a `share_ranking` rally action. The top 10 games (by Borda score) are stored in `metadata.ranking`.

### `GET /api/rally/active`
Requires session cookie. Returns today's active rally and all actions. Optional `?day_key=YYYY-MM-DD`.

**Response:**
```json
{
  "ok": true,
  "data": {
    "rally": { "id": "uuid", "timing": "now", "day_key": "2026-02-26", "status": "open", "created_at": "..." },
    "actions": [
      { "id": "uuid", "action_type": "in", "actor_id": "uuid", "actor_username": "Dave", "actor_avatar": null, "actor_discord_id": "...", "target_user_ids": null, "message": null, "metadata": null, "delivered": false, "delivery_status": "pending", "created_at": "...", "...": "..." }
    ],
    "bot": { "online": true, "last_seen_at": "2026-02-26T23:01:15.000Z" }
  }
}
```

- `delivery_status`: `"pending"` (waiting for the bot), `"delivered"` (`delivered = 1`) or `"expired"` (`delivered = 2`, or still `0` but older than 30 minutes). `delivered` stays a boolean, `true` only for delivered.
- `bot.online`: the bot polled this guild in the last 3 minutes. `false` means the bot is offline or no output channel is set (`/setchannel`); queued messages are dropped after 30 minutes. `last_seen_at` is the stored heartbeat (`null` if the bot never polled this guild).

### `GET /api/rally/tree`
Requires session cookie. Returns tree DAG data (nodes, edges, rallies, participants) for visualization. Optional `?day_key=YYYY-MM-DD`. Anonymous nodes are scrubbed as described above; edges are computed from the real actors before scrubbing, except that an anonymous response never gets a ping edge (it would name its actor). `participants` lists users who acted non-anonymously or were targeted, never a user only because of an anonymous action.

**Response:**
```json
{
  "ok": true,
  "data": {
    "nodes": [{ "id": "...", "action_type": "call", "actor_username": "Dave", ... }],
    "edges": [{ "source": "id1", "target": "id2", "type": "response" }],
    "rallies": [{ "id": "...", "day_key": "2026-02-26", "status": "open" }],
    "participants": { "uuid": { "username": "Dave", "avatar": "https://..." } }
  }
}
```

### `GET /api/rally/pending` (legacy)
Returns undelivered rally actions with resolved Discord IDs. Actions older than 30 minutes are skipped. Legacy: prefer `POST /api/bot/poll`.

**Auth:** `X-Bot-Token` header

### `PATCH /api/rally/:id/delivered` (legacy)
Marks a rally action as delivered. Legacy: prefer acks in `POST /api/bot/poll`.

**Auth:** `X-Bot-Token` header

### `POST /api/rally/tree/share`
Requires session cookie. Uploads a base64 PNG for Discord sharing. Cooldown per user (`429 RATE_LIMITED`).

**Body:**
```json
{ "image_data": "base64-png-data..." }
```

- `image_data`: plain base64 (no `data:` prefix), at most 1,400,000 characters (`TREE_SHARE_MAX_IMAGE_CHARS`, about 1 MB of PNG). Longer gives `413` with `{ "code": "PAYLOAD_TOO_LARGE" }`; not base64 gives `400 BAD_REQUEST`. The web app retries the export at 2x and 1x scale before giving up.
- The image is deleted (`image_data = NULL`) once the share is acknowledged or expires.

**Response (201):**
```json
{ "ok": true, "data": { "id": "uuid", "requested_by": "uuid", "day_key": "2026-02-26", "image_data": "...", "delivered": false, "created_at": "...", "bot_online": true } }
```

### `GET /api/rally/tree/share/pending` (legacy)
Returns undelivered tree share images. Shares older than 30 minutes are skipped. Legacy: prefer `POST /api/bot/poll`.

**Auth:** `X-Bot-Token` header

### `PATCH /api/rally/tree/share/:id/delivered` (legacy)
Marks a tree share as delivered. Legacy: prefer acks in `POST /api/bot/poll`.

**Auth:** `X-Bot-Token` header

---

## Settings

### `GET /api/settings`
Returns all settings as a key-value map. Requires session cookie. The internal key `bot_last_poll_at` is left out (and ignored by `PATCH /api/settings`).

### `PATCH /api/settings`
Updates settings. Requires session cookie. **Admin only** -- session must have been created via `POST /api/auth/admin-token` (Discord-gated: requires `ADMINISTRATOR` guild permission).

### `GET /api/settings/bot`
Returns all settings. **Auth:** `X-Bot-Token` header. Used by the bot to fetch `channel_id` on startup.

### `PATCH /api/settings/bot`
Updates settings. **Auth:** `X-Bot-Token` header. Used by the bot's `/setchannel` command to persist `channel_id` in D1.

**Body (all fields optional):**
```json
{
  "time_granularity_minutes": 15,
  "auto_archive_enabled": true,
  "game_pool_lifespan_days": 7,
  "gather_cooldown_seconds": 10,
  "gather_hourly_limit": 30,
  "avail_start_hour_et": 17,
  "avail_end_hour_et": 3,
  "day_reset_hour_et": 8,
  "rally_button_labels": { "call": "Call", "in": "In" },
  "rally_suggested_phrases": { "call": ["anyone?", "hop on!"] },
  "rally_show_discord_command": true
}
```
