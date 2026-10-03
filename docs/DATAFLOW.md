# Bot ↔ Server Dataflow

This document describes every communication channel between the Discord bot (`bot.mjs`)
and the when2play server. All connections are **outbound from the bot** — neither Discord
nor the when2play server ever initiates a connection to the bot process. The bot exposes no
listening port. All delivery to Discord is driven by the bot's polling loops.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                        Discord                                   │
│   User runs /in, /call, /post schedule, /when2play, etc.              │
└───────────────────────────────┬──────────────────────────────────┘
                            │ discord.js interactions
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│                  bot.mjs (single instance, multi-guild)          │
│                                                                  │
│   ┌──────────────────┐    ┌────────────────────────────────────┐ │
│   │ Command handlers │    │ Aggregated poller (lib/poller.mjs) │ │
│   │ /when2play, /call,    │    │ One POST /api/bot/poll per 15s:    │ │
│   │ /in, /out, ...   │    │ * guild_ids + acks of last cycle   │ │
│   └────────┬─────────┘    │ * deliver(guild, kind, item)       │ │
│            │              │ * ids queued for the next ack      │ │
│            │              └──────────────┬─────────────────────┘ │
└────────────┼─────────────────────────────┼───────────────────────┘
             │  HTTPS                      │  HTTPS
             │  Cookie: session_id=...     │  X-Bot-Token: ...
             │  X-Bot-Token: ...           │  body: { guild_ids, acks }
             │  X-Guild-Id: <guild_id>     │
             ▼                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                   when2play Server (Hono / CF Workers)           │
│                                                                  │
│   guildDb middleware (resolves DB binding from guild context)    │
│   requireAuth middleware      requireBotAuth middleware          │
│   (session_id cookie)         (X-Bot-Token header)               │
│                                                                  │
│   /api/auth/*                 /api/bot/poll                      │
│   /api/rally/action           /api/settings/bot                  │
│   /api/rally/judge/*          (legacy, unused by this bot:       │
│   /api/rally/share-ranking      */pending, */:id/delivered)      │
│   /api/gather (write)                                            │
│                                                                  │
│         ┌──────────┬──────────┬──────────┐                      │
│         │ D1 Guild │ D1 Guild │ D1 Guild │                      │
│         │    A     │    B     │    C     │                      │
│         └──────────┴──────────┴──────────┘                      │
└──────────────────────────────────────────────────────────────────┘
```

---

## Network Model

discord.js uses Discord's **Gateway** (WebSocket) model. On startup, the bot opens a
single outbound WebSocket connection to Discord. Discord then pushes all events (slash
command interactions, ready signals, etc.) over that persistent connection. There is no
inbound port, no public IP requirement, and no firewall rule needed on the bot host.

```
Bot Server                          Discord Gateway
     │                                     │
     │   wss://gateway.discord.gg          │
     ├──────────── connect ───────────────►│
     │◄─────────── HELLO ──────────────────┤
     │──────────── IDENTIFY ──────────────►│  (DISCORD_TOKEN sent here)
     │◄─────────── READY ──────────────────┤
     │                                     │
     │◄─────────── INTERACTION_CREATE ─────┤  (user ran /call, /in, etc.)
     │  handle interaction                 │
     │──────────── HTTP response ─────────►│  (reply or follow-up)
     │                                     │
     │  (every 15 s, independently)        │
     │────── POST /api/bot/poll ──────────►│  (not Discord -- this goes to when2play)
```

This is distinct from the **Interactions Endpoint URL** (HTTP webhook) model, where Discord
POSTs slash commands to a URL you expose. That model requires a public HTTPS server and
cryptographic signature verification on every request. This bot does not use that model.

The bot makes two kinds of outbound HTTPS calls:
- To **Discord's REST API** — to send replies, DMs, and channel messages.
- To the **when2play server** — to record actions and fetch pending deliveries.

---

## Authentication

There are two separate authentication mechanisms used in different contexts.

### 1. Bot-to-server authentication (`X-Bot-Token`)

Used when the bot acts on its own behalf (polling loops, delivery confirmations). The bot
sends `X-Bot-Token: <BOT_API_KEY>` in the request header. The server validates this against
the `BOT_API_KEY` environment variable via the `requireBotAuth` middleware. If the key is
missing or wrong the server returns 403; if `BOT_API_KEY` is not configured on the server
at all it returns 500 (fail-closed).

### 2. User session authentication (`session_id` cookie + `X-Bot-Token`)

Used when the bot runs commands on behalf of a Discord user. The bot includes both
`Cookie: session_id=...` and `X-Bot-Token` headers so the guild middleware can trust
the `X-Guild-Id` header for DB routing. Before calling any user-facing endpoint, the
bot runs `ensureUser()`, which:

1. Calls `POST /api/auth/token` with `X-Bot-Token` — server upserts the user in the DB
   and returns a one-time token (valid 10 minutes).
2. Calls `GET /api/auth/callback/:token` with `X-Bot-Token` — server consumes the token,
   creates a 7-day session, and returns `{ user, session: { session_id } }` as JSON
   (no cookie redirect, unlike the browser flow).
3. The returned `session_id` is then passed as `Cookie: session_id=<value>` on all
   subsequent API calls for that user.

A fresh `ensureUser()` is called at the start of every command invocation. Sessions created
this way are identical to browser sessions in the database.

---

## User Registration and Login Flow

This flow covers `/when2play` (and any command that needs a fresh user session).

```
User: /when2play (in guild 111...)
  |
bot.mjs calls POST /api/auth/token
  headers: X-Bot-Token, X-Guild-Id: 111...
  body:    { discord_id, discord_username, avatar_url }
  |
Server: guildDb middleware resolves DB_111... binding
        upsertUser() -- create or update users table row
        generateToken() -- random 32-byte hex string
        createAuthToken() -- insert into auth_tokens (expires in 10 min)
  returns: { token, url: "/auth/<token>?guild=111..." }
  |
Bot DMs the URL to the user
  (falls back to ephemeral channel reply if DMs are closed)
  |
User clicks link in browser
  |
Browser: /auth/<token>?guild=111...
  Frontend (AuthCallback.tsx) passes ?guild= through:
  -> GET /api/auth/callback/:token?guild=111...
  Server: guildDb middleware resolves DB from ?guild= param
          consumeAuthToken() -- validates and marks used
          createSession() -- insert into sessions (expires in 7 days)
  returns: Set-Cookie: guild_id=111..., session_id=<value> + redirect to /
  |
Browser loads dashboard (subsequent requests include both cookies)
```

For commands like `/in` or `/call`, the bot calls the same first two steps programmatically
to obtain a session, then uses it immediately to call the action endpoint:

```
Bot: ensureUser(discordUser, guildMember, guildId)
  -> POST /api/auth/token (X-Bot-Token, X-Guild-Id)   -> token
  -> GET  /api/auth/callback/:token (X-Bot-Token, X-Guild-Id) -> { session_id }
  |
Bot: apiCallWithSession(session_id, '/api/rally/action', { action_type: 'in', ... }, guildId)
  -> POST /api/rally/action
    Cookie: session_id=<value>
    X-Bot-Token: <BOT_API_KEY>
    X-Guild-Id: <guild_id>
    body: { action_type, message?, target_user_ids? }
  |
Server records action with delivered = 0
Bot replies to Discord user with confirmation
```

---

## Command → API Call Reference

### Auth & utility commands

| Command | API call | Auth type | Notes |
|---------|----------|-----------|-------|
| `/when2play` | `POST /api/auth/token` | X-Bot-Token | Generates login link, DMed to user |
| `/when2play-admin` | `POST /api/auth/admin-token` | X-Bot-Token | ADMINISTRATOR permission required; creates 1-hour admin session |
| `/url` | *(none)* | — | Returns `WHEN2PLAY_API_URL` directly |
| `/help` | *(none)* | — | Static text, ephemeral |

### Rally commands

All rally commands call `ensureUser()` first to obtain a session.

| Command | API call | Body |
|---------|----------|------|
| `/call [message]` | `POST /api/rally/call` | `{ message? }` |
| `/in [message]` | `POST /api/rally/action` | `{ action_type: 'in', message? }` |
| `/out [reason]` | `POST /api/rally/action` | `{ action_type: 'out', message? }` |
| `/ping @user [message]` | `POST /api/rally/action` | `{ action_type: 'ping', target_user_ids: [id], message? }` |
| `/brb [message]` | `POST /api/rally/action` | `{ action_type: 'brb', message? }` |
| `/where @user` | `POST /api/rally/action` | `{ action_type: 'where', target_user_ids: [id] }` |

### Coordination commands

| Command | API call | Body | Notes |
|---------|----------|------|-------|
| `/call2select @user` | `POST /api/auth/token` (for target), then `POST /api/rally/judge/avail` | `{ target_user_ids: [id] }` | Nudges target to set availability |
| `/post schedule` | `POST /api/rally/judge/time` | `{}` | Returns overlap windows; formats times using Discord timestamp tags |
| `/post gamerank` | `POST /api/rally/share-ranking` | `{}` | Posts top-10 games to channel |
| `/post gametree` | `GET /api/rally/active` + `POST /api/rally/tree/share` | image_data (base64 PNG) | Tree image generated client-side, uploaded via separate web flow |

---

## Polling Loop

The bot delivers everything the web dashboard queues for Discord (rally actions, tree share
images, game shares) through **one aggregated request per cycle**, implemented in
`lib/poller.mjs` and wired up in `bot.mjs`. Earlier versions made three `GET .../pending`
requests per guild per cycle plus one `PATCH .../delivered` per item; those endpoints still
exist on the Worker but are legacy and no longer used by this bot.

### Request

```
POST /api/bot/poll  (X-Bot-Token, no X-Guild-Id)
body: {
  "guild_ids": ["<guild id>", ...],
  "acks": { "<guild id>": { "rally_actions": [id...], "tree_shares": [id...], "game_shares": [id...] } }
}
```

- `guild_ids`: the guilds in `client.guilds.cache` that have an output channel
  (`/setchannel` value or `GAMING_CHANNEL_ID`). Guilds without a channel are not polled.
- `acks`: ids delivered to Discord since the last successful request (omitted when empty).
- Limits: at most 100 guilds and 200 ids per list per request. Anything above that is sent
  in the following cycles (logged once to `errors.log`).

### Response

```
{ "ok": true, "data": {
    "guilds": { "<guild id>": { "rally_actions": [...], "tree_shares": [...], "game_shares": [...] } },
    "unknown_guilds": ["<guild id with no database on the server>"],
    "errors": { "<guild id>": "<short message>" } } }
```

`guilds` contains only guilds with something to deliver, oldest item first. Item shapes are
the same as the legacy pending endpoints returned. The server applies the acks of a request
**before** selecting pending items, so an acked item never comes back.

### Delivery and acks

```
POST /api/bot/poll (guild_ids + acks from the previous cycle)
  ↓
For each guild (in parallel), for each kind in order rally -> tree -> game, for each item:
  Format with the pure formatters in lib/poller.mjs
  Post to the guild's output channel
    success -> queue the id for ack on the next request
    failure -> log, do not ack (the item comes back next poll);
               after 3 failed attempts for the same id, give up and ack it
  ↓
Wait, then poll again (the next request carries the queued acks)
```

- Acks piggyback on the next poll, so there is no per-item `PATCH` request.
- After a successful response the acks sent in that request are forgotten, except for
  guilds listed in `errors` (their acks may not have been applied, so they are sent again).
  Acks for guilds in `unknown_guilds` are dropped.
- If the request itself fails (network error, timeout, non-200, `ok !== true`), every ack is
  kept and sent again next cycle. Re-sending an ack is harmless.
- An item stays pending on the server until it is acked or is **older than 30 minutes**;
  the server then drops it silently. A message can therefore be lost if the bot is down
  for more than 30 minutes, but a missing ack never causes endless duplicates.
- One failing item never blocks the others.

`judge_time` actions contain a `metadata.windows` array of overlap time windows. The bot
formats these with Discord timestamp tags (`<t:unix:t>`) for auto-localization.
`share_ranking` actions contain a `metadata.ranking` array of games, posted as a numbered
list. `judge_avail` actions mention the target user(s). Tree shares are decoded from base64
and posted as a PNG attachment; game shares are posted with the game image as an embed.

### Timing, backoff and logging

- Base interval: 15 s, or `POLL_INTERVAL_MS` from the environment (minimum 5000).
- Polls never overlap: the next one is scheduled only after the previous request and all
  its deliveries finished.
- Request timeout: 20 s (tree shares carry images). Other Worker calls use 10 s.
- After consecutive request failures the delay is `min(base * 2^(failures - 1), 2 min)`,
  reset on the first success. Each failure is written to `errors.log` and the console.
- An HTTP 404 from `/api/bot/poll` means the Worker is older than the bot: deploy the
  Worker first.
- `unknown_guilds` are logged once per process; a guild in `errors` is logged on first
  occurrence and then at most once every 10 minutes.
- Delivery failures are logged to `errors.log` and the console with the attempt count.

### Gather pings (DEPRECATED)

Gather was merged into the rally system. The bot no longer polls `/api/gather/pending`.
The server-side endpoints still exist for backward compatibility but no new pings can be
created (UI tab hidden since v0.3).

---

## Complete Endpoint Inventory

### User-authenticated (`Cookie: session_id`)

| Method | Path | Called by | Purpose |
|--------|------|-----------|---------|
| `POST` | `/api/rally/call` | `/call` command | Start/join today's rally |
| `POST` | `/api/rally/action` | `/in`, `/out`, `/ping`, `/brb`, `/where` | Record rally action |
| `POST` | `/api/rally/judge/time` | `/post schedule` | Compute availability overlap windows |
| `POST` | `/api/rally/judge/avail` | `/call2select` | Nudge user(s) to set availability |
| `POST` | `/api/rally/share-ranking` | `/post gamerank` | Share game rankings to channel |
| `GET` | `/api/rally/active` | `/post gametree` | Fetch today's rally + actions |

### Bot-authenticated (`X-Bot-Token` + `X-Guild-Id`)

All bot-authenticated requests include `X-Guild-Id: <guild_id>` to route to the correct
guild database, except `POST /api/bot/poll`, which carries its guild ids in the body.
The Worker's guild middleware trusts this header only when `X-Bot-Token` matches
`BOT_API_KEY`.

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/bot/poll` | Aggregated poll: ack delivered items and fetch pending items for many guilds (no `X-Guild-Id`) |
| `POST` | `/api/auth/token` | Create one-time login token for a user |
| `POST` | `/api/auth/admin-token` | Create one-time admin login token |
| `GET` | `/api/auth/callback/:token` | Exchange token for session (JSON response, no cookie) |
| `GET` | `/api/rally/pending` | Legacy, no longer used by this bot (replaced by `/api/bot/poll`) |
| `PATCH` | `/api/rally/:id/delivered` | Legacy, no longer used by this bot (replaced by `/api/bot/poll` acks) |
| `GET` | `/api/rally/tree/share/pending` | Legacy, no longer used by this bot |
| `PATCH` | `/api/rally/tree/share/:id/delivered` | Legacy, no longer used by this bot |
| `GET` | `/api/gather/pending` | ~~Fetch undelivered gather pings~~ (deprecated, no longer polled) |
| `PATCH` | `/api/gather/:id/delivered` | ~~Mark gather ping delivered~~ (deprecated) |
| `GET` | `/api/games/share/pending` | Legacy, no longer used by this bot |
| `PATCH` | `/api/games/share/:id/delivered` | Legacy, no longer used by this bot |
| `GET` | `/api/settings/bot` | Fetch guild settings (channel_id, guild_name) |
| `PATCH` | `/api/settings/bot` | Update guild settings (used by `/setchannel`) |

---

## Shared Secrets and Environment

Both the bot and server must share exactly one secret: `BOT_API_KEY`.

| Variable | Where set | Description |
|----------|-----------|-------------|
| `BOT_API_KEY` | Bot `.env`, Server `wrangler secret` | Shared 64-char hex key; must match exactly |
| `DISCORD_TOKEN` | Bot `.env` only | Discord bot token |
| `WHEN2PLAY_API_URL` | Bot `.env` only | Base URL of the server (e.g. `https://when2play.example.workers.dev`) |
| `GAMING_CHANNEL_ID` | Bot `.env`, optional | Fallback Discord channel ID. Optional if using `/setchannel` (which persists to D1) |
| `POLL_INTERVAL_MS` | Bot `.env`, optional | Base poll interval in ms (default 15000, values below 5000 are ignored) |

`X-Guild-Id` is **not a secret**. It is a Discord guild snowflake (public identifier) sent
as a plain header. The Worker's guild middleware only trusts it from bot-authenticated
requests (validated via `X-Bot-Token`). For browser requests, guild context comes from the
`guild_id` cookie (httpOnly, set by the server).

On the server side, `BOT_API_KEY` is accessed via the Cloudflare Worker binding
`c.env.BOT_API_KEY`. If it is not set, `requireBotAuth` returns HTTP 500 immediately
(fail-closed — bot endpoints are entirely unavailable rather than open).

---

## User Identity Mapping

Discord users are identified by their `discord_id` (Discord's snowflake string). The
when2play server assigns each user a separate internal UUID (`users.id`). The mapping is
maintained by `upsertUser()`, called on every `POST /api/auth/token` request:

- If no row exists with this `discord_id` → insert new user with a fresh UUID.
- If a row exists → update `discord_username` and `avatar_url` in place.

Rally and gather action rows store internal `user_id` (UUID). When the polling endpoints
return data for the bot to act on, the server resolves these UUIDs back to `discord_id`
values (via a JOIN on the users table) and includes them as `target_discord_ids` in the
response, so the bot can @mention the right Discord users without doing its own lookups.

---

## Security

### Transport security

| Channel | Protocol | How it's authenticated |
|---------|----------|----------------------|
| Bot ↔ Discord Gateway | WSS (TLS WebSocket) | `DISCORD_TOKEN` sent in the IDENTIFY packet; all traffic is encrypted in transit |
| Bot → Discord REST API | HTTPS | `Authorization: Bot <DISCORD_TOKEN>` header on every request |
| Bot → when2play server | HTTPS | `X-Bot-Token` or `Cookie: session_id` header; Cloudflare Workers enforce TLS and cannot be reached over plain HTTP |

### Attack surface

The bot process has no inbound ports and initiates all connections itself, so the network
attack surface on the bot host is effectively zero — no firewall rules need to expose it.
The relevant risks are limited to secret exposure:

**`DISCORD_TOKEN` leaking.** If this token is exposed, an attacker can impersonate the bot
on Discord entirely: read messages, send messages, run commands. Keep it only in `.env`
(which must be gitignored). If leaked, regenerate it immediately in the Discord Developer
Portal — the old token is instantly invalidated.

**`BOT_API_KEY` leaking.** If this key is exposed, an attacker can call the when2play
server's bot-authenticated endpoints: read pending rally actions and gather pings, and mark
them as delivered (silently dropping notifications). They cannot write new actions or access
user data beyond what those polling endpoints return. Keep it only in `.env` and in
`wrangler secret`. Rotate by generating a new 64-char hex key and updating both sides.

**`.env` committed to git.** The most common real-world mistake. Confirm `.env` is listed
in `.gitignore` before the first commit. If it was ever committed, treat both secrets as
compromised and rotate them.

**Bot host compromise.** Since the bot is a long-running process, a compromised host gives
an attacker access to the in-memory secrets. Standard host hardening applies, but no
additional when2play-specific mitigations are needed beyond keeping the host patched.
