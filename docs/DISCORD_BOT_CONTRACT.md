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

### 3. Mark Ping Delivered

```bash
PATCH /api/gather/:id/delivered
X-Bot-Token: <BOT_API_KEY>
```

**Response:**
```json
{ "ok": true, "data": null }
```

## Discord ID Resolution

The gather pending response already includes resolved Discord IDs — no bot-side mapping is needed:

- **`sender_discord_id`**: The sender's numeric Discord ID. Use `<@sender_discord_id>` in Discord messages to mention them.
- **`target_discord_ids`**: Array of numeric Discord IDs (or `null` for broadcast). Use `<@id>` to mention each.

The internal `user_id` (UUID) is included for reference but is not needed for Discord interactions.

## Rate Limits

- **Gather bell**: Configurable cooldown (default 30 minutes per user, controlled by `gather_cooldown_minutes` setting)
- **Auth tokens**: Expire after 10 minutes, one-time use
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
            sender = "Someone" if ping["is_anonymous"] else f"<@{ping['sender_discord_id']}>"
            msg = ping["message"] or "Ready to play!"
            text = f"🔔 **Gather bell!** {sender}: {msg}"
            if ping.get("target_discord_ids"):
                mentions = " ".join(f"<@{uid}>" for uid in ping["target_discord_ids"])
                text += f" → {mentions}"
            await channel.send(text)
            requests.patch(f"{API_URL}/api/gather/{ping['id']}/delivered", headers=HEADERS)
        await asyncio.sleep(15)
```
