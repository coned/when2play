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
│   User runs /in, /call, /post schedule, /play, etc.              │
└───────────────────────────────┬──────────────────────────────────┘
                            │ discord.js interactions
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│                  bot.mjs (single instance, multi-guild)          │
│                                                                  │
│   ┌──────────────────┐    ┌────────────────────────────────────┐ │
│   │ Command handlers │    │ Per-guild polling loops (every 15s)│ │
│   │ /play, /call,    │    │  For each guild in config:         │ │
│   │ /in, /out, ...   │    │  * pollRallyActions(guildId, cfg)  │ │
│   └────────┬─────────┘    │  * pollGatherPings(guildId, cfg)   │ │
│            │              │  * pollTreeShares(guildId, cfg)    │ │
│            │              └──────────────┬─────────────────────┘ │
└────────────┼─────────────────────────────┼───────────────────────┘
             │  HTTPS                      │  HTTPS
             │  Cookie: session_id=...     │  X-Bot-Token: ...
             │  X-Bot-Token: ...           │  X-Guild-Id: <guild_id>
             │  X-Guild-Id: <guild_id>     │
             ▼                             ▼
┌──────────────────────────────────────────────────────────────────┐
│                   when2play Server (Hono / CF Workers)           │
│                                                                  │
│   guildDb middleware (resolves DB binding from guild context)    │
│   requireAuth middleware      requireBotAuth middleware          │
│   (session_id cookie)         (X-Bot-Token header)               │
│                                                                  │
│   /api/auth/*                 /api/rally/pending                 │
│   /api/rally/action           /api/rally/:id/delivered           │
│   /api/rally/judge/*          /api/rally/tree/share/pending      │
│   /api/rally/share-ranking    /api/rally/tree/share/:id/...      │
│   /api/gather (write)         /api/gather/pending                │
│                               /api/gather/:id/delivered          │
│                               /api/settings/bot                  │
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
     │────── GET /api/rally/pending ──────►│  (not Discord — this goes to when2play)
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

This flow covers `/play` (and any command that needs a fresh user session).

```
User: /play (in guild 111...)
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
| `/play` | `POST /api/auth/token` | X-Bot-Token | Generates login link, DMed to user |
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

## Polling Loops

The bot runs three polling loops per guild, scheduled via `scheduleNextPoll()`. For each
guild the bot has joined (`client.guilds.cache`), all three loops fire every 15 seconds under normal
conditions, with per-guild exponential backoff on errors (doubles each failure, capped at
2 minutes, resets on first success for that guild). All API requests include the
`X-Guild-Id` header so the Worker routes them to the correct guild database.

### Loop 1: Rally actions (`pollRallyActions`)

Fetches undelivered rally actions and posts them to `GAMING_CHANNEL_ID`.

```
GET /api/rally/pending  (X-Bot-Token)
  ↓
Returns: RallyAction[] with resolved target_discord_ids
  ↓
For each action (action_type ∈ {call, in, out, ping, brb, where,
                                judge_time, judge_avail, share_ranking}):
  Format Discord message
  Post to GAMING_CHANNEL_ID
  ↓
PATCH /api/rally/:id/delivered  (X-Bot-Token)
```

`judge_time` actions contain a `metadata.windows` array of overlap time windows.
The bot formats these with Discord timestamp tags (`<t:unix:t>`) for auto-localization.

`share_ranking` actions contain a `metadata.ranking` array of games. Posted as a numbered list.

`judge_avail` actions mention the target user(s) and link to the when2play site.

### Loop 2: Gather pings (`pollGatherPings`)

Fetches undelivered gather bells and posts them to `GAMING_CHANNEL_ID`.

```
GET /api/gather/pending  (X-Bot-Token)
  ↓
Returns: GatherPing[] with resolved sender_discord_id and target_discord_ids
  ↓
For each ping:
  Build @mention list (targeted) or "@here" (broadcast)
  Format message with sender name and optional custom message
  Post to GAMING_CHANNEL_ID
  ↓
PATCH /api/gather/:id/delivered  (X-Bot-Token)
```

### Loop 3: Tree share images (`pollTreeShares`)

Fetches pending gaming-tree PNG uploads (submitted via the web dashboard) and posts them
as image attachments.

```
GET /api/rally/tree/share/pending  (X-Bot-Token)
  ↓
Returns: TreeShare[] with base64-encoded PNG in image_data field
  ↓
For each share:
  Decode base64 → Buffer
  Post as Discord file attachment to GAMING_CHANNEL_ID
  ↓
PATCH /api/rally/tree/share/:id/delivered  (X-Bot-Token)
```

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
guild database. The Worker's guild middleware trusts this header only when `X-Bot-Token`
matches `BOT_API_KEY`.

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/auth/token` | Create one-time login token for a user |
| `POST` | `/api/auth/admin-token` | Create one-time admin login token |
| `GET` | `/api/auth/callback/:token` | Exchange token for session (JSON response, no cookie) |
| `GET` | `/api/rally/pending` | Fetch undelivered rally actions |
| `PATCH` | `/api/rally/:id/delivered` | Mark rally action delivered |
| `GET` | `/api/rally/tree/share/pending` | Fetch pending tree share images |
| `PATCH` | `/api/rally/tree/share/:id/delivered` | Mark tree share delivered |
| `GET` | `/api/gather/pending` | Fetch undelivered gather pings |
| `PATCH` | `/api/gather/:id/delivered` | Mark gather ping delivered |
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
