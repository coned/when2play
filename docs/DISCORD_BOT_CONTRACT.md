# when2play — Discord Bot Integration Contract

This document defines the API contract that a Discord bot must follow to integrate with when2play.

## Overview

The Discord bot is responsible for:
1. **Authentication** — Creating one-time auth links for users
2. **Gather notifications** — Polling for and delivering gather bell pings

## Endpoints

### 1. Create Auth Token

When a user types `/play` (or similar command) in Discord:

```bash
POST /api/auth/token
Content-Type: application/json

{
  "discord_id": "123456789012345678",
  "discord_username": "GamerDave",
  "avatar_url": "https://cdn.discordapp.com/avatars/123/abc.png"
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

The bot should DM the user with `data.url`. The token expires in 10 minutes.

### 2. Poll for Gather Pings

Periodically (every 10-30 seconds):

```bash
GET /api/gather/pending
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
      "created_at": "2026-02-26T19:00:00.000Z"
    }
  ]
}
```

For each pending ping, the bot should:
1. Look up the user's Discord username
2. Send a message to the gaming channel (e.g., "@GamerDave is ready to play! CS2 anyone?")
3. Mark the ping as delivered

### 3. Mark Ping Delivered

```bash
PATCH /api/gather/:id/delivered
```

**Response:**
```json
{ "ok": true, "data": null }
```

## Authentication

Bot-facing endpoints (`POST /api/auth/token`, `GET /api/gather/pending`, `PATCH /api/gather/:id/delivered`) currently have **no authentication**. When deploying to production:

1. Add a `BOT_API_KEY` secret to the Worker
2. The bot sends `X-Bot-Token: <key>` header on all requests
3. The Worker validates the header on bot-facing endpoints

## User ID Mapping

The bot needs to map `user_id` (UUID) back to Discord users. Options:
- Store the mapping locally when creating auth tokens
- Call `GET /api/users/me` with the user's session (not recommended for bot)
- Extend the gather pending response to include `discord_id` (recommended future enhancement)

## Rate Limits

- Gather bell: configurable cooldown (default 30 minutes per user)
- Auth tokens: expire after 10 minutes, one-time use

## Example Bot Flow (Python pseudocode)

```python
# On /play command
async def handle_play(interaction):
    response = requests.post(f"{API_URL}/api/auth/token", json={
        "discord_id": str(interaction.user.id),
        "discord_username": interaction.user.display_name,
        "avatar_url": str(interaction.user.avatar.url) if interaction.user.avatar else None
    })
    data = response.json()["data"]
    await interaction.user.send(f"Click to open when2play: {data['url']}")

# Polling loop
async def poll_gather():
    while True:
        response = requests.get(f"{API_URL}/api/gather/pending")
        pings = response.json()["data"]
        for ping in pings:
            channel = bot.get_channel(GAMING_CHANNEL_ID)
            await channel.send(f"Someone is ready to play! {ping['message'] or ''}")
            requests.patch(f"{API_URL}/api/gather/{ping['id']}/delivered")
        await asyncio.sleep(15)
```
