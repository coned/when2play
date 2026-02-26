# when2play — API Reference

Base URL: `/api`

All responses follow the format:

```json
// Success
{ "ok": true, "data": { ... } }

// Error
{ "ok": false, "error": { "code": "ERROR_CODE", "message": "Description" } }
```

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

**Body:**
```json
{
  "discord_id": "123456789",
  "discord_username": "GamerDave",
  "avatar_url": "https://cdn.discordapp.com/..."  // optional
}
```

**Response (201):**
```json
{ "ok": true, "data": { "token": "abc123...", "url": "https://host/auth/abc123..." } }
```

### `GET /api/auth/callback/:token`
Exchanges a one-time token for a session cookie. Redirects to `/`.

**Response:** `302 Found` with `Set-Cookie: session_id=...; HttpOnly; SameSite=Lax; Path=/`

### `POST /api/auth/logout`
Requires session cookie. Destroys the session.

**Response:**
```json
{ "ok": true, "data": null }
```

---

## Users

All endpoints require session cookie.

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
  "name": "Counter-Strike 2",
  "steam_app_id": "730",     // optional
  "image_url": "https://..."  // optional
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
Returns all votes for a specific game.

### `GET /api/games/ranking`
Returns aggregated Borda count ranking of all active games.

---

## Availability

All endpoints require session cookie.

### `GET /api/availability`
Query params: `?user_id=...&date=YYYY-MM-DD` (both optional)

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

**Body:**
```json
{ "message": "CS2 anyone?" }  // optional
```

### `GET /api/gather/pending`
Returns undelivered gather pings. Used by the Discord bot.

### `PATCH /api/gather/:id/delivered`
Marks a gather ping as delivered. Used by the Discord bot.

---

## Shame

All endpoints require session cookie.

### `POST /api/shame/:targetId`
Shames another user. One shame per voter-target pair per day.

**Body:**
```json
{ "reason": "No-showed last night" }  // optional
```

### `GET /api/shame/leaderboard`
Returns the shame leaderboard sorted by shame count.

---

## Settings

All endpoints require session cookie.

### `GET /api/settings`
Returns all settings as a key-value map.

### `PATCH /api/settings`
Updates settings.

**Body:**
```json
{
  "time_granularity_minutes": 30,
  "game_pool_lifespan_days": 14
}
```

---

## Steam

### `GET /api/steam/lookup/:appId`
Requires session cookie. Looks up a Steam game by App ID.

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
