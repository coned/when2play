# when2play — API Reference

Base URL: `/api`

All responses follow the format:

```json
// Success
{ "ok": true, "data": { ... } }

// Error
{ "ok": false, "error": { "code": "ERROR_CODE", "message": "Description" } }
```

Error messages are redacted in production (HTTPS) for unhandled exceptions.

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
  "avatar_url": "https://cdn.discordapp.com/..."  // max 500 chars, optional
}
```

**Response (201):**
```json
{ "ok": true, "data": { "token": "abc123...", "url": "https://host/auth/abc123..." } }
```

### `GET /api/auth/callback/:token`
Exchanges a one-time token for a session cookie. Redirects to `/`.

**Response:** `302 Found` with `Set-Cookie: session_id=...; HttpOnly; SameSite=Strict; Path=/`

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
Returns the current authenticated user.

### `PATCH /api/users/me`
Updates the current user's profile.

**Body (all fields optional):**
```json
{
  "discord_username": "NewName",
  "timezone": "America/New_York",
  "time_granularity_minutes": 30
}
```

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
Requires session cookie. Rings the gather bell. Rate-limited by `gather_cooldown_minutes` setting.

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
      "message": "CS2 anyone?",
      "delivered": false,
      "is_anonymous": false,
      "target_user_ids": null,
      "created_at": "2026-02-26T19:00:00.000Z"
    }
  ]
}
```

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
{ "reason": "No-showed last night" }  // optional, max 200 chars
```

### `GET /api/shame/leaderboard`
Returns the shame leaderboard sorted by shame count. Includes latest 3 reasons per user.

**Response:**
```json
{
  "ok": true,
  "data": [
    {
      "user_id": "uuid",
      "discord_username": "GamerDave",
      "avatar_url": "https://...",
      "shame_count": 5,
      "recent_reasons": ["No-showed", "AFK", "Dodged"]
    }
  ]
}
```

---

## Settings

All endpoints require session cookie.

### `GET /api/settings`
Returns all settings as a key-value map.

### `PATCH /api/settings`
Updates settings. **Admin only** — restricted to the first registered user.

**Body:**
```json
{
  "time_granularity_minutes": 30,
  "game_pool_lifespan_days": 14
}
```
