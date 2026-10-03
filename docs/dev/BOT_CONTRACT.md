# when2play — Discord Bot Integration Contract

This document defines the API contract that a Discord bot must follow to integrate with when2play.

## Overview

The Discord bot is responsible for:
1. **Authentication** — Creating one-time auth links for users
2. **Admin access** — Creating one-time admin links for Discord server administrators
3. **Gather notifications** — Polling for and delivering gather bell pings
4. **Rally actions** — 8 slash commands for session coordination (call/in/out/ping/judge/brb/where/tree)
5. **Rally delivery** — Polling for and delivering rally action messages to Discord
6. **Tree sharing** — Polling for and posting gaming tree images to Discord
7. **Game sharing** — Polling for and posting game cards (name, note, reactions, image) to Discord

Items 5 to 7 share one aggregated request per cycle: `POST /api/bot/poll` (see [Delivery Polling](#delivery-polling-recommended-post-apibotpoll)).

## Authentication

All bot-facing endpoints require the `X-Bot-Token` header matching the `BOT_API_KEY` Cloudflare Worker secret:

```
X-Bot-Token: <your-bot-api-key>
```

Set the secret via `npx wrangler secret put BOT_API_KEY` (locally: `.dev.vars`). Bot auth fails closed: when the secret is not set, every bot endpoint answers `503` with error code `BOT_AUTH_NOT_CONFIGURED`. A wrong or missing token answers `403 FORBIDDEN`.

### Acting as a user (slash commands)

Slash commands that act for a Discord user (`/call`, `/in`, `/ping` ...) should call the normal user routes with three headers instead of minting a session:

```
X-Bot-Token: <BOT_API_KEY>
X-Guild-Id: 123456789012345678
X-Discord-User-Id: <interaction.user.id>
```

The Worker authenticates the request as the user whose `discord_id` matches, in that guild's database. Rules:

- Only available when `BOT_API_KEY` is set on the Worker. With a missing or wrong `X-Bot-Token`, `X-Discord-User-Id` is ignored and the request is treated as an unauthenticated browser request (`401`).
- Unknown `discord_id` in that guild: `401 UNAUTHORIZED` ("Unknown Discord user for this server"). Call `POST /api/users/sync` for the user (and for any ping target) first; one sync call takes up to 10 users.
- The bot is never admin this way (`PATCH /api/settings` gives `403`), and no session exists.
- Accepted by every route that takes a session cookie: `/api/rally/*` user routes (`call`, `action`, `judge/time`, `judge/avail`, `share-ranking`, `active`, `tree`, `tree/share`), `/api/users`, `/api/users/me`, `/api/games/*`, `/api/availability/*`, `/api/shame/*`, `/api/settings` (read) and `/api/gather`. Do not use it for `/api/auth/logout` or `/api/guilds/switch` (browser session helpers).

### `POST /api/users/sync`

Creates or refreshes users without tokens or sessions. Bot-auth, guild scoped.

```bash
POST /api/users/sync
Content-Type: application/json
X-Bot-Token: <BOT_API_KEY>
X-Guild-Id: 123456789012345678

{
  "users": [
    { "discord_id": "111111111111111111", "discord_username": "GamerDave", "avatar_url": "https://cdn.discordapp.com/avatars/1/a.png" },
    { "discord_id": "222222222222222222", "discord_username": "Alice" }
  ],
  "guild_name": "My Server"
}
```

- `users`: 1 to 10 entries; `discord_id` 1-30 chars, `discord_username` 1-50 chars (prefer the guild nickname), `avatar_url` optional, max 500 chars, `null` allowed (keeps the stored avatar). `guild_name` optional, max 100 chars, stored like `/api/auth/token` does.
- Response `200`: `{ "ok": true, "data": { "users": [ { "id", "discord_id", "discord_username", "display_name", "avatar_url" } ] } }`, in request order. Use `id` for `target_user_ids`.
- Errors: `400 BAD_REQUEST` (invalid body, 0 or more than 10 users), `403 FORBIDDEN` (wrong token), `404 UNKNOWN_GUILD` / `400 INVALID_GUILD` / `400 MISSING_GUILD` from the guild header.

### Errors a slash command can now receive

All error bodies are `{ "ok": false, "error": { "code", "message" } }`; `message` is safe to show to the user.

| Status | Code | When |
|--------|------|------|
| 401 | `UNAUTHORIZED` | act-as with a `discord_id` not synced to this guild |
| 400 | `BAD_REQUEST` | `is_anonymous: true` on an action type the admin did not enable (setting `rally_anonymous_enabled`, default call and ping), non-boolean `is_anonymous`, message over 500 chars, `target_user_ids` not 1-20 ids of existing users, unknown `rally_id`, body not a JSON object |
| 429 | `RATE_LIMITED` | cooldown (same user, same action type, `gather_cooldown_seconds`, default 10 s) or hourly limit (`gather_hourly_limit` rally actions per user per 60 min, default 30). Message ends with `Try again in Ns`. Game shares and tree shares have the cooldown too. |
| 413 | `PAYLOAD_TOO_LARGE` | tree share `image_data` over 1,400,000 characters |

## Guild Context

All API requests from the bot must include the `X-Guild-Id` header with the Discord guild (server) snowflake ID, except `POST /api/bot/poll`, which is cross-guild and takes its guild IDs in the body. The Worker uses this header to route each request to the correct per-guild D1 database.

```
X-Guild-Id: 123456789012345678
```

The guild ID is available as `interaction.guildId` in discord.js. If the bot is used in DMs (no guild context), it should reject the command early and not call the API.

The Worker validates that the guild ID is a Discord snowflake (`/^\d{17,20}$/`). If a per-guild D1 binding (`DB_<guildId>`) exists, it is used; otherwise the request fails with `404 UNKNOWN_GUILD`.

## Delivery Polling (recommended): `POST /api/bot/poll`

Rally actions, tree shares and game shares are delivered through one aggregated request per polling cycle (every 15 seconds) covering every guild the bot is in. It replaces endpoints 5 to 10 below, which remain only for older bot builds.

```bash
POST /api/bot/poll
Content-Type: application/json
X-Bot-Token: <BOT_API_KEY>
# no X-Guild-Id

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

**Request rules:**
- `guild_ids` (required): guild ID strings (`/^\d{17,20}$/`), duplicates ignored, at most 100 distinct. May be empty.
- `acks` (optional): keyed by guild ID (at most 100 keys). Each value may contain `rally_actions`, `tree_shares`, `game_shares` (no other keys), each a list of at most 200 non-empty ID strings (max 100 chars each). Acks are applied for any guild with a DB binding, even one not in `guild_ids`.
- Anything else: `400 BAD_REQUEST`. Wrong or missing `X-Bot-Token` (when `BOT_API_KEY` is set): `403 FORBIDDEN`.

**Response (200):**
```json
{
  "ok": true,
  "data": {
    "guilds": {
      "926950608127287346": {
        "rally_actions": [ /* same items as GET /api/rally/pending */ ],
        "tree_shares":   [ /* same items as GET /api/rally/tree/share/pending */ ],
        "game_shares":   [ /* same items as GET /api/games/share/pending */ ]
      }
    },
    "unknown_guilds": [],
    "errors": {}
  }
}
```

- `guilds` holds only guilds with something to deliver (`{}` when idle); a present guild always has all three arrays, each ordered oldest first.
- `unknown_guilds` lists requested or acked guild IDs that have no DB binding on the Worker.
- `errors` maps a guild ID to a short message when that guild failed twice on the server (it is retried once). The guild is absent from `guilds` and its acks may not have been applied; keep those acks and send them again next cycle. The status is still 200.

**Ack semantics:** after posting an item to Discord, remember its ID and send it in `acks` on the next poll. Acks are applied before the pending items are read, so an acked item is never returned again. Acks are idempotent: re-sending an ID, or an ID that no longer exists, is harmless. Until an item is acked it is returned on every poll, so ack each item exactly after it has been posted (a crash between posting and acking re-posts that item once).

**Staleness rule:** an item that has not been acked within 30 minutes of its creation is never returned; the server marks it expired (`delivered = 2`, where `1` means acknowledged) instead. A bot coming back after an outage therefore never posts a stale backlog. The legacy pending endpoints apply the same 30 minute filter. The web app shows each action as pending, delivered or expired.

**Heartbeat:** each poll records the time in the settings of every guild in `guild_ids` (`bot_last_poll_at`, written at most once per 60 seconds). The web app treats the bot as offline for a guild that has not been polled for 3 minutes and warns users that messages are not being picked up. So: keep polling every guild that has an output channel, even when idle, and keep the error backoff at 2 minutes or less. A guild without an output channel is not polled, which the web app reports the same way.

**Tree share images:** an ack (and the legacy `PATCH .../delivered`) or an expiry deletes the PNG (`image_data = NULL`). Read `image_data` from the poll response; never fetch it again after acking.

**Anonymous actions:** `actor_id`, `actor_username`, `actor_avatar` and `actor_discord_id` of an anonymous action are scrubbed by the server (see [Anonymous Actions](#anonymous-actions)).

## Endpoints

### 1. Create Auth Token

When a user types `/when2play` (or similar command) in Discord:

```bash
POST /api/auth/token
Content-Type: application/json
X-Bot-Token: <BOT_API_KEY>
X-Guild-Id: 123456789012345678

{
  "discord_id": "123456789012345678",    # 1-30 chars, required
  "discord_username": "GamerDave",       # 1-50 chars, required (prefer guild nickname)
  "avatar_url": "https://cdn.discordapp.com/avatars/123/abc.png",  # max 500 chars, optional
  "guild_name": "My Server"             # max 100 chars, optional (saved to settings for display)
}
```

> **Important:** `discord_username` should be the user's **guild nickname** (server-specific display name), not their global display name. Use `interaction.member.displayName` (discord.js) or `interaction.user.display_name` within a guild context (discord.py) to get the server nickname, falling back to the global name if no nickname is set.

**Response (201):**
```json
{
  "ok": true,
  "data": {
    "token": "a1b2c3d4...",
    "url": "https://when2play.example.com/auth/a1b2c3d4...?guild=123456789012345678"
  }
}
```

The returned URL includes `?guild=<guildId>` so the browser callback sets a `guild_id` cookie for subsequent requests.

The bot should DM the user with `data.url`. The token expires in 10 minutes and is single-use.

**Validation errors (400):** Returned if body fields fail Zod validation (missing, too long, etc.).

**Auth errors (403):** Returned if `X-Bot-Token` doesn't match `BOT_API_KEY`.

**Cleanup:** every call to this endpoint or to `/api/auth/admin-token` deletes used or expired auth tokens and expired sessions first.

For slash commands, prefer [acting as a user](#acting-as-a-user-slash-commands) over this token plus `GET /api/auth/callback/:token` (with `X-Bot-Token`), which mints a 7 day session per call. The token flow keeps working for the `/when2play` login link and for older bot builds.

### 2. Create Admin Auth Token

When a Discord user with the `ADMINISTRATOR` server permission runs `/when2play-admin`:

```bash
POST /api/auth/admin-token
Content-Type: application/json
X-Bot-Token: <BOT_API_KEY>
X-Guild-Id: 123456789012345678

{
  "discord_id": "123456789012345678",    # 1-30 chars, required
  "discord_username": "GuildAdmin",      # 1-50 chars, required (prefer guild nickname)
  "avatar_url": "https://cdn.discordapp.com/avatars/123/abc.png"  # max 500 chars, optional
}
```

**Response (201):**
```json
{
  "ok": true,
  "data": {
    "token": "a1b2c3d4...",
    "url": "https://when2play.example.com/auth/a1b2c3d4...?guild=123456789012345678"
  }
}
```

The bot should DM the user with `data.url`. The token expires in 10 minutes, is single-use, and grants an admin browser session (no `Max-Age`, expires on browser close; DB TTL 1 hour).

**Bot responsibility:** Only call this endpoint after verifying the requesting Discord member has `ADMINISTRATOR` permission in the guild. The API trusts the bot to enforce this gate.

**Admin session properties:**
- Cookie has no `Max-Age` — expires when the browser closes
- Session DB row expires after 1 hour regardless
- `GET /api/users/me` returns `is_admin: true` while the session is active
- `PATCH /api/settings` is allowed

### 3. Poll for Gather Pings

Periodically (every 10-30 seconds):

```bash
GET /api/gather/pending
X-Bot-Token: <BOT_API_KEY>
X-Guild-Id: 123456789012345678
```

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

For each pending ping, the bot should:

1. **Check `is_anonymous`**: If `true`, hide the sender's identity (e.g., "Someone is ready to play!")
2. **Check `target_discord_ids`**: If non-null, only mention those specific Discord users. These are already resolved to numeric Discord IDs — use `<@ID>` syntax directly.
3. **Send a message** to the gaming channel
4. **Mark as delivered** (see below)

### 4. Mark Ping Delivered

```bash
PATCH /api/gather/:id/delivered
X-Bot-Token: <BOT_API_KEY>
X-Guild-Id: 123456789012345678
```

**Response:**
```json
{ "ok": true, "data": null }
```

### 5. Poll for Rally Actions (legacy)

Legacy: use `POST /api/bot/poll` instead; the item shape and formatting rules below still apply to its `rally_actions`. Actions older than 30 minutes are not returned.

```bash
GET /api/rally/pending
X-Bot-Token: <BOT_API_KEY>
X-Guild-Id: 123456789012345678
```

**Response:**
```json
{
  "ok": true,
  "data": [
    {
      "id": "action-uuid",
      "rally_id": "rally-uuid",
      "actor_id": "user-uuid",
      "actor_discord_id": "123456789012345678",
      "actor_username": "GamerDave",
      "action_type": "call",
      "target_user_ids": null,
      "target_discord_ids": null,
      "message": "now",
      "metadata": null,
      "delivered": false,
      "day_key": "2026-02-26",
      "created_at": "2026-02-26T19:00:00.000Z"
    }
  ]
}
```

For each pending action, format a Discord message using the universal `label — "message"` pattern. When a message is present, it appears after the action label as ` — "message"`. When absent, only the label shows (with any default punctuation).

| action_type | No message | With message |
|-------------|------------|--------------|
| `call` | `📢 **User** called` | `📢 **User** called — "message"` |
| `in` | `✅ **User** is in!` | `✅ **User** is in — "message"` |
| `out` | `❌ **User** is out` | `❌ **User** is out — "message"` |
| `ping` | `👋 **User** → @Target` | `👋 **User** → @Target — "message"` |
| `judge_time` | Two-line: `📅 **Best window:** <t:TS:t>–<t:TS:t> (Alice, Bob)` + `📋 **All windows today (N):**\n• ...` + `_On behalf of User_` | *(metadata-driven, times as Discord timestamps)* |
| `judge_avail` | `🤖 **User** → @Target: Please set your availability!` | *(metadata-driven)* |
| `brb` | `⏳ **User** brb` | `⏳ **User** brb — "message"` |
| `where` | `❓ **User** → @Target` | `❓ **User** → @Target — "message"` |
| `share_ranking` | `🏆 **Game Rankings:**\n#1 Name (X pts, Y votes)` | *(metadata-driven)* |

#### Anonymous Actions

When `metadata.is_anonymous === true` on a rally action, the bot should display "Someone" instead of `<@discord_id>`. This applies to any action type. For example:
- `call` with anonymous: `📢 **Someone** called` instead of `📢 **<@123>** called`
- `in` with anonymous: `✅ **Someone** is in!`

The server never sends the identity of an anonymous actor, neither here nor in `GET /api/rally/active` / `GET /api/rally/tree`: such actions carry `actor_id: "__anonymous__"`, `actor_username: "Anonymous"`, `actor_avatar: null` and `actor_discord_id: null`. `target_discord_ids` is unchanged (the targets are not anonymous). Rallies no longer include `creator_id`.

`is_anonymous: true` is only accepted for action types enabled in the admin setting `rally_anonymous_enabled` (default `{"call": true, "ping": true}`); other types get `400 BAD_REQUEST`.

**`share_ranking` metadata format:**
```json
{
  "ranking": [
    { "name": "Counter-Strike 2", "total_score": 15, "vote_count": 4 },
    { "name": "Valorant", "total_score": 12, "vote_count": 3 }
  ]
}
```
The bot should format this as a numbered list, e.g.:
```
🏆 Game Rankings:
#1 Counter-Strike 2 (15 pts, 4 votes)
#2 Valorant (12 pts, 3 votes)
```

### 6. Mark Rally Action Delivered (legacy)

Legacy: send the ID in `acks.<guild>.rally_actions` of the next `POST /api/bot/poll` instead.

```bash
PATCH /api/rally/:id/delivered
X-Bot-Token: <BOT_API_KEY>
X-Guild-Id: 123456789012345678
```

### 7. Poll for Tree Share Images (legacy)

Legacy: use `POST /api/bot/poll` (`tree_shares`). Shares older than 30 minutes are not returned.

```bash
GET /api/rally/tree/share/pending
X-Bot-Token: <BOT_API_KEY>
X-Guild-Id: 123456789012345678
```

Returns pending tree images with `image_data` (base64 PNG, no `data:` prefix, at most 1,400,000 characters). The bot should decode and send as a Discord attachment. `image_data` is set to `null` once the share is acknowledged or expires.

### 8. Mark Tree Share Delivered (legacy)

Legacy: send the ID in `acks.<guild>.tree_shares` instead.

```bash
PATCH /api/rally/tree/share/:id/delivered
X-Bot-Token: <BOT_API_KEY>
X-Guild-Id: 123456789012345678
```

## Rally Slash Commands

### 9. Poll for Game Shares (legacy)

Legacy: use `POST /api/bot/poll` instead; the item shape and posting rules below still apply to its `game_shares`. Shares older than 30 minutes are not returned.

```bash
GET /api/games/share/pending
X-Bot-Token: <BOT_API_KEY>
X-Guild-Id: 123456789012345678
```

**Response:**
```json
{
  "ok": true,
  "data": [
    {
      "id": "share-uuid",
      "game_id": "game-uuid",
      "requested_by": "user-uuid",
      "delivered": false,
      "created_at": "2026-03-10T...",
      "game_name": "Counter-Strike 2",
      "game_note": "Great FPS",
      "game_image_url": "https://cdn.akamai.steamstatic.com/steam/apps/730/header.jpg",
      "game_steam_app_id": "730",
      "like_count": 3,
      "dislike_count": 1,
      "requester_name": "GamerDave"
    }
  ]
}
```

For each pending share, the bot should:
1. Format a Discord message with the game name, note (if present), like/dislike score, and Steam store link (if `game_steam_app_id` is present)
2. Attach the game image as an embed thumbnail (if `game_image_url` is present)
3. Send to the gaming channel
4. Mark as delivered (see below)

### 10. Mark Game Share Delivered (legacy)

Legacy: send the ID in `acks.<guild>.game_shares` instead.

```bash
PATCH /api/games/share/:id/delivered
X-Bot-Token: <BOT_API_KEY>
X-Guild-Id: 123456789012345678
```

## Rally Slash Commands

The bot registers the following slash commands:

| Command | Description | Options |
|---------|-------------|---------|
| `/when2play` | Get a login link for the dashboard | — |
| `/when2play-admin` | Get an admin link (requires ADMINISTRATOR) | — |
| `/help` | Show all commands (ephemeral) | — |
| `/call` | Call everyone to play | `message` (string, optional) |
| `/in` | Join the rally | `message` (string, optional) |
| `/out` | Bail from rally | `reason` (string, optional) |
| `/ping` | Ping someone to come play | `user` (required), `message` (optional) |
| `/brb` | Be right back | `message` (optional) |
| `/where` | Ask where someone is | `user` (required) |
| `/call2select` | Nudge someone to set their availability | `user` (required) |
| `/post schedule` | Find and post best overlapping time windows | — |
| `/post gamerank` | Post current game rankings to channel | — |
| `/post gametree` | Post today's gaming tree diagram | — |
| `/url` | Get the website URL | — |

Each command authenticates the user (today via the auth token flow; preferably via `POST /api/users/sync` plus the act-as headers, see [Acting as a user](#acting-as-a-user-slash-commands)), then calls the appropriate rally API endpoint.

## Discord ID Resolution

The gather pending response already includes resolved Discord IDs — no bot-side mapping is needed:

- **`sender_discord_id`**: The sender's numeric Discord ID. Use `<@sender_discord_id>` in Discord messages to mention them.
- **`target_discord_ids`**: Array of numeric Discord IDs (or `null` for broadcast). Use `<@id>` to mention each.

The internal `user_id` (UUID) is included for reference but is not needed for Discord interactions.

## Rate Limits

- **Cooldown** (`gather_cooldown_seconds`, default 10, 0 = disabled): per user, for the same rally action type (`call`, `in`, `out`, `brb`, `ping`, `where`, `judge_time`, `judge_avail`, `share_ranking`), for game shares, for tree shares and for gather pings. Returns `429 RATE_LIMITED`, message `Cooldown active. Try again in Ns`.
- **Hourly limit** (`gather_hourly_limit`, default 30, 0 = disabled): rally actions (all types) per user per rolling 60 minutes, and gather pings. Returns `429 RATE_LIMITED`, message `Hourly limit reached. Try again in Ns`, until the oldest action in the window ages out.
- **Auth tokens**: Expire after 10 minutes, one-time use
- **Admin sessions**: Expire after 1 hour (or on browser close, whichever comes first)
- **Shame votes**: One per voter-target pair per day

## Gather Ping Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Ping UUID |
| `user_id` | string | Internal UUID of the sender (for reference) |
| `sender_discord_id` | string | Numeric Discord ID of the sender — use `<@id>` to mention |
| `sender_username` | string | Discord username of the sender |
| `message` | string \| null | Optional message (max 500 chars) |
| `delivered` | boolean | Whether the bot has picked this up |
| `is_anonymous` | boolean | If true, hide sender identity |
| `target_user_ids` | string[] \| null | Internal UUIDs of targets (for reference) |
| `target_discord_ids` | string[] \| null | Numeric Discord IDs of targets — use `<@id>` to mention each |
| `created_at` | string | ISO 8601 timestamp |

## Example Bot Implementation

See [Deployment Guide](../user/DEPLOYMENT.md#part-2-discord-bot) for setup instructions and the `when2play_discordbot` repository for the full implementation.

### Python pseudocode

```python
import os, requests, asyncio

API_URL = os.environ["WHEN2PLAY_API_URL"]
BOT_API_KEY = os.environ["BOT_API_KEY"]

def guild_headers(guild_id):
    return {
        "Content-Type": "application/json",
        "X-Bot-Token": BOT_API_KEY,
        "X-Guild-Id": str(guild_id),
    }

# On /when2play command
async def handle_play(interaction):
    member = interaction.guild.get_member(interaction.user.id)
    display_name = member.display_name if member else interaction.user.display_name
    response = requests.post(f"{API_URL}/api/auth/token", json={
        "discord_id": str(interaction.user.id),
        "discord_username": display_name,  # guild nickname preferred
        "avatar_url": str(interaction.user.avatar.url) if interaction.user.avatar else None,
    }, headers=guild_headers(interaction.guild_id))
    data = response.json()["data"]
    await interaction.user.send(f"Click to open when2play: {data['url']}")

# Polling loop (per guild)
async def poll_gather(guild_id, channel_id):
    while True:
        headers = guild_headers(guild_id)
        response = requests.get(f"{API_URL}/api/gather/pending", headers=headers)
        pings = response.json()["data"]
        for ping in pings:
            channel = bot.get_channel(channel_id)
            sender = "Someone" if ping["is_anonymous"] else f"<@{ping['sender_discord_id']}>"
            msg = ping["message"] or "Ready to play!"
            text = f"🔔 **Gather bell!** {sender}: {msg}"
            if ping.get("target_discord_ids"):
                mentions = " ".join(f"<@{uid}>" for uid in ping["target_discord_ids"])
                text += f" → {mentions}"
            await channel.send(text)
            requests.patch(f"{API_URL}/api/gather/{ping['id']}/delivered", headers=headers)
        await asyncio.sleep(15)

# Delivery loop (all guilds, one request per cycle) for rally actions, tree shares, game shares
async def poll_deliveries(channels):  # channels: {guild_id: channel}
    acks = {}  # guild_id -> {"rally_actions": [...], "tree_shares": [...], "game_shares": [...]}
    while True:
        try:
            response = requests.post(f"{API_URL}/api/bot/poll", json={
                "guild_ids": [str(g) for g in channels],
                "acks": acks,
            }, headers={"Content-Type": "application/json", "X-Bot-Token": BOT_API_KEY})
            data = response.json()["data"]
        except Exception:
            await asyncio.sleep(15)
            continue  # keep acks, resend next cycle

        # Acks for guilds that failed server-side may not be applied: keep them.
        acks = {g: a for g, a in acks.items() if g in data["errors"]}
        for guild_id, items in data["guilds"].items():
            channel = channels[guild_id]
            done = acks.setdefault(guild_id, {"rally_actions": [], "tree_shares": [], "game_shares": []})
            for action in items["rally_actions"]:
                await channel.send(format_rally_action(action))
                done["rally_actions"].append(action["id"])
            for share in items["tree_shares"]:
                await channel.send(file=decode_png(share["image_data"]))
                done["tree_shares"].append(share["id"])
            for share in items["game_shares"]:
                await channel.send(embed=format_game_card(share))
                done["game_shares"].append(share["id"])
        await asyncio.sleep(15)
```
