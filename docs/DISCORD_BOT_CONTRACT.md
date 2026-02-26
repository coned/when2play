# when2play — Discord Bot Integration Contract

This document defines the API contract that a Discord bot must follow to integrate with when2play.

## Overview

The Discord bot is responsible for:
1. **Authentication** — Creating one-time auth links for users
2. **Gather notifications** — Polling for and delivering gather bell pings

## Authentication

All bot-facing endpoints require the `X-Bot-Token` header matching the `BOT_API_KEY` Cloudflare Worker secret:

```
X-Bot-Token: <your-bot-api-key>
```

Set the secret via `npx wrangler secret put BOT_API_KEY`. When the secret is not set, the auth check is skipped (local dev only).

## Endpoints

### 1. Create Auth Token

When a user types `/play` (or similar command) in Discord:

```bash
POST /api/auth/token
Content-Type: application/json
X-Bot-Token: <BOT_API_KEY>

{
  "discord_id": "123456789012345678",    # 1-30 chars, required
  "discord_username": "GamerDave",       # 1-50 chars, required
  "avatar_url": "https://cdn.discordapp.com/avatars/123/abc.png"  # max 500 chars, optional
}
```

**Response (201):**
```json
{
  "ok": true,
  "data": {
    "token": "a1b2c3d4...",
    "url": "https://when2play.example.com/auth/a1b2c3d4..."
  }
}
```

The bot should DM the user with `data.url`. The token expires in 10 minutes and is single-use.

**Validation errors (400):** Returned if body fields fail Zod validation (missing, too long, etc.).

**Auth errors (403):** Returned if `X-Bot-Token` doesn't match `BOT_API_KEY`.

### 2. Poll for Gather Pings

Periodically (every 10-30 seconds):

```bash
GET /api/gather/pending
X-Bot-Token: <BOT_API_KEY>
```

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

For each pending ping, the bot should:

1. **Check `is_anonymous`**: If `true`, hide the sender's identity (e.g., "Someone is ready to play!")
2. **Check `target_user_ids`**: If non-null, only notify those specific users. These are internal UUIDs — the bot must map them to Discord user IDs (see [User ID Mapping](#user-id-mapping))
3. **Send a message** to the gaming channel
4. **Mark as delivered** (see below)

### 3. Mark Ping Delivered

```bash
PATCH /api/gather/:id/delivered
X-Bot-Token: <BOT_API_KEY>
```

**Response:**
```json
{ "ok": true, "data": null }
```

## User ID Mapping

The API uses internal UUIDs for `user_id` and `target_user_ids`. The bot needs to map these back to Discord user IDs. Options:

- **Cache on token creation**: When `POST /api/auth/token` is called, store the mapping `internal_user_id ↔ discord_id` locally. The response doesn't return the internal user ID directly, but you can track the discord_id you sent.
- **Future enhancement**: Extend the gather pending response to include `discord_id` alongside `user_id`.

## Rate Limits

- **Gather bell**: Configurable cooldown (default 30 minutes per user, controlled by `gather_cooldown_minutes` setting)
- **Auth tokens**: Expire after 10 minutes, one-time use
- **Shame votes**: One per voter-target pair per day

## Gather Ping Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Ping UUID |
| `user_id` | string | Internal UUID of the sender |
| `message` | string \| null | Optional message (max 500 chars) |
| `delivered` | boolean | Whether the bot has picked this up |
| `is_anonymous` | boolean | If true, hide sender identity |
| `target_user_ids` | string[] \| null | If non-null, only notify these users (internal UUIDs, max 20) |
| `created_at` | string | ISO 8601 timestamp |

## Example Bot Implementation

See `docs/SETUP.md` Part 3 for a complete working example using discord.js (Node.js).

### Python pseudocode

```python
import os, requests, asyncio

API_URL = os.environ["WHEN2PLAY_API_URL"]
BOT_API_KEY = os.environ["BOT_API_KEY"]
HEADERS = {
    "Content-Type": "application/json",
    "X-Bot-Token": BOT_API_KEY,
}

# On /play command
async def handle_play(interaction):
    response = requests.post(f"{API_URL}/api/auth/token", json={
        "discord_id": str(interaction.user.id),
        "discord_username": interaction.user.display_name,
        "avatar_url": str(interaction.user.avatar.url) if interaction.user.avatar else None,
    }, headers=HEADERS)
    data = response.json()["data"]
    await interaction.user.send(f"Click to open when2play: {data['url']}")

# Polling loop
async def poll_gather():
    while True:
        response = requests.get(f"{API_URL}/api/gather/pending", headers=HEADERS)
        pings = response.json()["data"]
        for ping in pings:
            channel = bot.get_channel(GAMING_CHANNEL_ID)
            sender = "Someone" if ping["is_anonymous"] else f"A player"
            msg = ping["message"] or "Ready to play!"
            await channel.send(f"🔔 {sender}: {msg}")
            requests.patch(f"{API_URL}/api/gather/{ping['id']}/delivered", headers=HEADERS)
        await asyncio.sleep(15)
```
