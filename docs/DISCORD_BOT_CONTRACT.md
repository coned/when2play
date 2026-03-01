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

## Authentication

All bot-facing endpoints require the `X-Bot-Token` header matching the `BOT_API_KEY` Cloudflare Worker secret:

```
X-Bot-Token: <your-bot-api-key>
```

Set the secret via `npx wrangler secret put BOT_API_KEY`. When the secret is not set, the auth check is skipped (local dev only).

## Guild Context

All API requests from the bot must include the `X-Guild-Id` header with the Discord guild (server) snowflake ID. The Worker uses this to route each request to the correct per-guild D1 database.

```
X-Guild-Id: 123456789012345678
```

The guild ID is available as `interaction.guildId` in discord.js. If the bot is used in DMs (no guild context), it should reject the command early and not call the API.

The Worker validates that the guild ID is a Discord snowflake (`/^\d{17,20}$/`). If a per-guild D1 binding (`DB_<guildId>`) exists, it is used; otherwise the Worker falls back to the default `DB` binding.

## Endpoints

### 1. Create Auth Token

When a user types `/play` (or similar command) in Discord:

```bash
POST /api/auth/token
Content-Type: application/json
X-Bot-Token: <BOT_API_KEY>
X-Guild-Id: 123456789012345678

{
  "discord_id": "123456789012345678",    # 1-30 chars, required
  "discord_username": "GamerDave",       # 1-50 chars, required (prefer guild nickname)
  "avatar_url": "https://cdn.discordapp.com/avatars/123/abc.png"  # max 500 chars, optional
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

### 5. Poll for Rally Actions

Periodically (every 15 seconds, alongside gather polling):

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

### 6. Mark Rally Action Delivered

```bash
PATCH /api/rally/:id/delivered
X-Bot-Token: <BOT_API_KEY>
X-Guild-Id: 123456789012345678
```

### 7. Poll for Tree Share Images

```bash
GET /api/rally/tree/share/pending
X-Bot-Token: <BOT_API_KEY>
X-Guild-Id: 123456789012345678
```

Returns pending tree images with `image_data` (base64 PNG). The bot should decode and send as a Discord attachment.

### 8. Mark Tree Share Delivered

```bash
PATCH /api/rally/tree/share/:id/delivered
X-Bot-Token: <BOT_API_KEY>
X-Guild-Id: 123456789012345678
```

## Rally Slash Commands

The bot registers the following slash commands:

| Command | Description | Options |
|---------|-------------|---------|
| `/play` | Get a login link for the dashboard | — |
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

Each command authenticates the user via the auth token flow, then calls the appropriate rally API endpoint.

## Discord ID Resolution

The gather pending response already includes resolved Discord IDs — no bot-side mapping is needed:

- **`sender_discord_id`**: The sender's numeric Discord ID. Use `<@sender_discord_id>` in Discord messages to mention them.
- **`target_discord_ids`**: Array of numeric Discord IDs (or `null` for broadcast). Use `<@id>` to mention each.

The internal `user_id` (UUID) is included for reference but is not needed for Discord interactions.

## Rate Limits

- **Gather bell per-ping cooldown**: 10 seconds per user (controlled by `gather_cooldown_seconds` setting, 0 = disabled)
- **Gather bell hourly limit**: 30 pings per rolling 60-minute window (controlled by `gather_hourly_limit` setting, 0 = disabled). Exceeding the limit returns 429 with a lockout until the oldest ping in the window ages out.
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

See `docs/SETUP.md` Part 3 for a complete working example using discord.js (Node.js).

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

# On /play command
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
```
