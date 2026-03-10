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

---

## Health

### `GET /api/health`
No auth required.

**Response:**
```json
{ "ok": true, "data": { "status": "healthy", "timestamp": "2026-02-26T00:00:00.000Z" } }
```

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

All endpoints require session cookie.

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
Returns the current authenticated user. Includes `is_admin: boolean` — `true` when the session was created via an admin token.

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

All endpoints require session cookie.

### `GET /api/games`
Lists active games. Add `?include_archived=true` to include archived games.

### `POST /api/games`
Proposes a new game.

**Body:**
```json
{
  "name": "Counter-Strike 2",     // required, max 100 chars
  "steam_app_id": "730",          // optional
  "image_url": "https://..."      // optional, max 500 chars
}
```

### `PATCH /api/games/:id`
Updates a game. Only the proposer can update.

### `DELETE /api/games/:id`
Archives a game (soft delete). Only the proposer can archive.

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

**Note:** `user_id` is scoped to the authenticated user when no `date` filter is provided (prevents cross-user personal data access).

### `PUT /api/availability`
Bulk-replaces all availability slots for a given date.

**Body:**
```json
{
  "date": "2026-03-01",
  "slots": [
    { "start_time": "19:00", "end_time": "19:15" },
    { "start_time": "19:15", "end_time": "19:30" }
  ]
}
```

### `DELETE /api/availability?date=YYYY-MM-DD`
Clears all slots for the given date.

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

### `POST /api/rally/call`
Requires session cookie. Creates or gets today's rally and records a `call` action.

**Body (all fields optional):**
```json
{
  "timing": "now"  // "now" or "later", defaults to "now"
}
```

**Response (201):**
```json
{
  "ok": true,
  "data": {
    "rally": { "id": "uuid", "creator_id": "uuid", "timing": "now", "day_key": "2026-02-26", "status": "open", "created_at": "..." },
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
  "target_user_ids": ["uuid"],       // required for ping/where
  "message": "on my way"             // optional, max 500 chars
}
```

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

`start`/`end` are UTC `HH:MM` strings. Windows are sorted by `user_count` descending, then `start` ascending. Adjacent windows with the same user set are merged.

### `POST /api/rally/judge/avail`
Requires session cookie. Nudges a user to set availability.

**Body:**
```json
{ "target_user_ids": ["uuid"] }
```

### `POST /api/rally/share-ranking`
Requires session cookie. Broadcasts the current game ranking to Discord via a `share_ranking` rally action. The top 10 games (by Borda score) are stored in `metadata.ranking`.

### `GET /api/rally/active`
Requires session cookie. Returns today's active rally and all actions. Optional `?day_key=YYYY-MM-DD`.

### `GET /api/rally/tree`
Requires session cookie. Returns tree DAG data (nodes, edges, rallies) for visualization. Optional `?day_key=YYYY-MM-DD`.

**Response:**
```json
{
  "ok": true,
  "data": {
    "nodes": [{ "id": "...", "action_type": "call", "actor_username": "Dave", ... }],
    "edges": [{ "source": "id1", "target": "id2", "type": "response" }],
    "rallies": [{ "id": "...", "day_key": "2026-02-26", "status": "open" }]
  }
}
```

### `GET /api/rally/pending`
Returns undelivered rally actions with resolved Discord IDs.

**Auth:** `X-Bot-Token` header

### `PATCH /api/rally/:id/delivered`
Marks a rally action as delivered.

**Auth:** `X-Bot-Token` header

### `POST /api/rally/tree/share`
Requires session cookie. Uploads a base64 PNG for Discord sharing.

**Body:**
```json
{ "image_data": "base64-png-data..." }
```

### `GET /api/rally/tree/share/pending`
Returns undelivered tree share images.

**Auth:** `X-Bot-Token` header

### `PATCH /api/rally/tree/share/:id/delivered`
Marks a tree share as delivered.

**Auth:** `X-Bot-Token` header

---

## Settings

### `GET /api/settings`
Returns all settings as a key-value map. Requires session cookie.

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
