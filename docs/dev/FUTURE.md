# Cloudflare-Native Discord Bot — Migration Guide

This document describes how to replace the standalone `discord.js` bot (see [Deployment Guide](../user/DEPLOYMENT.md#part-2-discord-bot)) with a fully Cloudflare-native implementation - no separate server required.

---

## Background: The Problem with the Current Bot

The current bot uses **discord.js** with the Discord **Gateway API**: the bot process opens a persistent WebSocket to Discord and maintains it indefinitely. This requires:

- A long-lived process (VPS, home server, or paid hosting)
- Infrastructure management (pm2, systemd, Docker, etc.)
- Occasional `ConnectTimeoutError` noise when the bot's host has transient network hiccups reaching the Cloudflare Worker backend

The error looks like:
```
Error polling gather pings: TypeError: fetch failed
  [cause]: ConnectTimeoutError: Connect Timeout Error
    (attempted addresses: 172.67.154.68:443, timeout: 10000ms)
    code: 'UND_ERR_CONNECT_TIMEOUT'
```

This is a transient network issue on the bot's host — the bot itself doesn't crash because `pollGatherPings` is wrapped in try/catch. But it highlights the fragility of running a Node.js process as an independent service.

---

## The Cloudflare-Native Alternative

Discord supports a second integration model: **HTTP Interactions**. Instead of the bot connecting to Discord, Discord sends an HTTP POST to a URL you provide whenever a slash command is used.

Combined with Cloudflare's **Cron Triggers**, the full bot can live inside the existing Worker:

```
Slash command (/play, /when2play-admin)
  → Discord sends signed POST to your Worker URL
  → Worker verifies signature, handles command, returns JSON response

Gather polling
  → Cloudflare Cron Trigger fires on schedule
  → Worker fetches /api/gather/pending (internal), posts to Discord REST API
```

Zero external infrastructure.

---

## Trade-off Summary

| Concern | discord.js bot (current) | Cloudflare-native |
|---|---|---|
| Hosting | Requires VPS or paid service | None — runs on the Worker |
| Maintenance | Process must stay running 24/7 | Fully managed by Cloudflare |
| Transient network errors | Yes (bot host → Cloudflare) | Eliminated (everything in-network) |
| Gather polling latency | 15 seconds | 1 minute (free), ~1 second (paid) |
| Slash command response | Via Gateway (immediate) | Via HTTP Interactions (immediate) |
| Implementation complexity | Simple, familiar discord.js | Requires Ed25519 sig verification |
| Discord library | discord.js (feature-rich) | Raw HTTP/REST (minimal) |
| Gateway events | Available | Not available |

**Key limitation:** Cloudflare Cron Triggers have a **minimum interval of 1 minute on the free tier** (vs. the current 15 seconds). For a gather bell feature this is generally acceptable. On a paid plan the minimum is ~1 second.

**Hard limitation:** HTTP Interactions cannot receive arbitrary Gateway events (e.g., message events, reaction events). If the bot ever needs to listen to those, this model won't work.

---

## Implementation Plan

### 1. Discord Application Changes

In the [Discord Developer Portal](https://discord.com/developers/applications):

1. Select your application → **General Information**
2. Set **Interactions Endpoint URL** to:
   ```
   https://when2play.<your-subdomain>.workers.dev/api/discord/interactions
   ```
3. Discord will immediately send a `PING` request to verify the endpoint. The Worker must respond correctly (see step 3) before Discord accepts the URL.
4. Remove the bot token from your environment — it is no longer needed for slash commands. You will still need it for outbound Discord REST calls (posting to channels).

### 2. Register Slash Commands via REST

Without a running bot process, commands must be registered once via the Discord REST API. Do this with a one-time curl or script after any command change:

```bash
curl -X PUT \
  https://discord.com/api/v10/applications/<APPLICATION_ID>/commands \
  -H "Authorization: Bot <BOT_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '[
    {"name": "play", "description": "Get a login link for when2play", "type": 1},
    {"name": "when2play-admin", "description": "Get a one-time admin link (requires ADMINISTRATOR)", "type": 1}
  ]'
```

### 3. New Worker Route: `POST /api/discord/interactions`

This route handles all slash command interactions. The critical requirement is **Ed25519 signature verification** — Discord will reject any endpoint that doesn't verify correctly.

```typescript
// Pseudocode — integrate into your existing Hono router

import { verifyKey } from 'discord-interactions'; // or implement manually

POST /api/discord/interactions:

  // 1. Verify signature (REQUIRED — Discord drops endpoints that skip this)
  const signature = request.headers.get('X-Signature-Ed25519');
  const timestamp  = request.headers.get('X-Signature-Timestamp');
  const rawBody    = await request.text();

  const isValid = await verifyKey(rawBody, signature, timestamp, DISCORD_PUBLIC_KEY);
  if (!isValid) return new Response('Unauthorized', { status: 401 });

  const body = JSON.parse(rawBody);

  // 2. Respond to Discord's PING (endpoint verification)
  if (body.type === 1) {
    return Response.json({ type: 1 });
  }

  // 3. Slash command dispatch
  if (body.type === 2) {
    switch (body.data.name) {
      case 'play':            return handlePlay(body, env);
      case 'when2play-admin': return handleAdminPlay(body, env);
    }
  }

  return new Response('Unknown interaction type', { status: 400 });
```

The `handlePlay` and `handleAdminPlay` functions call the existing `/api/auth/token` and `/api/auth/admin-token` logic internally (direct function call, not HTTP), then return a Discord **ephemeral message** response:

```json
{
  "type": 4,
  "data": {
    "content": "Check your DMs for the login link!",
    "flags": 64
  }
}
```

DM sending (the `/play` DM with the auth URL) must happen via the Discord REST API using a follow-up webhook call, since the initial response has a 3-second deadline.

### 4. New Secret: `DISCORD_PUBLIC_KEY`

```bash
npx wrangler secret put DISCORD_PUBLIC_KEY
# Paste the Public Key from Discord Developer Portal → General Information
```

The bot token (for outbound REST calls, e.g. posting to the gather channel) is also needed:

```bash
npx wrangler secret put DISCORD_BOT_TOKEN
```

And the gather channel ID (currently an env var in the bot):

```bash
npx wrangler secret put DISCORD_GAMING_CHANNEL_ID
```

### 5. Cron Trigger for Gather Polling

In `wrangler.jsonc`, add:

```jsonc
"triggers": {
  "crons": ["* * * * *"]   // every minute (free tier minimum)
}
```

In `src/index.ts`, export a `scheduled` handler alongside the existing `fetch` handler:

```typescript
export default {
  fetch: app.fetch,

  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext) {
    await pollAndDeliverGatherPings(env);
  },
};
```

`pollAndDeliverGatherPings` calls the gather DB query directly (no HTTP roundtrip) and posts to Discord's REST API for any pending pings.

---

## New Environment Variables

| Name | Set via | Purpose |
|------|---------|---------|
| `DISCORD_PUBLIC_KEY` | `wrangler secret put` | Ed25519 public key for verifying interaction signatures |
| `DISCORD_BOT_TOKEN` | `wrangler secret put` | Bot token for outbound Discord REST (channel posts, DMs) |
| `DISCORD_GAMING_CHANNEL_ID` | `wrangler secret put` | Channel ID to post gather pings to |

`BOT_API_KEY` remains unchanged (guards bot-facing API endpoints).

---

## What Does NOT Change

- All existing API routes (`/api/auth/token`, `/api/gather/pending`, etc.) are unchanged
- The bot contract ([BOT_CONTRACT.md](BOT_CONTRACT.md)) is unchanged - a third-party bot can still use those endpoints
- The existing discord.js bot can continue running alongside the Worker during migration

---

## Sequence: Slash Command Flow (HTTP Interactions)

```
User types /play in Discord
    │
    ▼
Discord sends POST /api/discord/interactions
  with Ed25519-signed body
    │
    ▼
Worker verifies signature
    │
    ▼
Worker calls auth token logic (internal)
    │
    ├─► Returns ephemeral reply: "Check your DMs"
    │
    └─► Sends follow-up to Discord REST API:
        POST discord.com/api/v10/channels/{DM_channel_id}/messages
        body: { content: "Click to open when2play: <url>" }
```

## Sequence: Gather Polling (Cron Trigger)

```
Cloudflare Cron fires (every minute)
    │
    ▼
Worker scheduled() handler
    │
    ▼
Query DB for pending gather pings
    │
    ├─ None → exit
    │
    └─ Pings found:
        │
        ▼
       For each ping:
         POST discord.com/api/v10/channels/{GAMING_CHANNEL_ID}/messages
         PATCH gather ping as delivered in DB
```

---

## Decision Guide

Migrate to Cloudflare-native if:
- You want zero-infrastructure hosting
- 1-minute gather polling latency is acceptable
- You only need slash commands (no Gateway events)

Keep the discord.js bot if:
- You need sub-15s gather delivery
- You want to add Gateway-based features later (reaction events, message listeners, etc.)
- You prefer simplicity over infrastructure consolidation
