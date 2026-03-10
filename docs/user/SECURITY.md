# Security Reference

---

## Bot Authentication

Bot-facing endpoints require the `X-Bot-Token` header matching the `BOT_API_KEY` Cloudflare secret:

```
X-Bot-Token: <your-bot-api-key>
```

Set the secret via `npx wrangler secret put BOT_API_KEY`. When the secret is not set, the check is skipped (local dev mode only).

Protected endpoints:
- `POST /api/auth/token` - create login tokens for Discord users
- `POST /api/auth/admin-token` - create admin login tokens
- `GET /api/gather/pending` + `PATCH /api/gather/:id/delivered` - gather ping delivery
- `GET /api/rally/pending` + `PATCH /api/rally/:id/delivered` - rally action delivery
- `GET /api/rally/tree/share/pending` + `PATCH /api/rally/tree/share/:id/delivered` - tree image delivery
- `GET /api/settings/bot` + `PATCH /api/settings/bot` - guild settings

If `BOT_API_KEY` is not configured on the server, `requireBotAuth` returns HTTP 500 immediately (fail-closed: bot endpoints are entirely unavailable rather than open).

---

## Admin Privileges

Admin access is Discord-gated. There is no default admin. A Discord server member with the `ADMINISTRATOR` permission must run the `/when2play-admin` bot command to receive a one-time admin login link.

**Admin session properties:**
- Browser-session cookie only (no `Max-Age`) - expires when the browser closes
- DB session expires after 1 hour regardless
- `GET /api/users/me` returns `is_admin: true` while active
- `PATCH /api/settings` is allowed

---

## Transport Security

| Channel | Protocol | Authentication |
|---------|----------|----------------|
| Bot to Discord Gateway | WSS (TLS WebSocket) | `DISCORD_TOKEN` sent in the IDENTIFY packet; all traffic encrypted |
| Bot to Discord REST API | HTTPS | `Authorization: Bot <DISCORD_TOKEN>` header |
| Bot to when2play server | HTTPS | `X-Bot-Token` or `Cookie: session_id` header; Cloudflare Workers enforce TLS |
| Browser to when2play server | HTTPS | `session_id` cookie |

---

## Cookie Security

**Regular sessions:** `HttpOnly`, `SameSite=Strict`, `Path=/`, `Secure` (production only), `Max-Age=604800` (7 days).

**Admin sessions:** same flags but **no `Max-Age`** (browser-session cookie). DB row expires after 1 hour regardless.

**Guild context cookie:** `guild_id` uses the same attributes as `session_id` (`HttpOnly`, `Secure`, `SameSite=Strict`, `Path=/`). `HttpOnly` prevents client-side JavaScript from reading the guild context. Users can modify cookies via browser devtools, but this only results in 401 (self-denial), not cross-guild access.

---

## Guild ID Trust Boundary

The `X-Guild-Id` header is only trusted when the request also carries a valid `X-Bot-Token`. The guild middleware verifies the bot token (a string comparison against `c.env.BOT_API_KEY`) before reading the header. This prevents browsers from spoofing guild context, since browsers can set arbitrary request headers via `fetch()`.

For browser requests (no valid bot token), guild context comes exclusively from:
- The `guild_id` cookie (httpOnly, set by the server during auth callback)
- The `guild` query parameter (used only during the auth callback redirect)

### Guild ID format validation

Guild IDs are validated as Discord snowflakes (17-20 digit numeric strings) before use as a dynamic property key (`env["DB_" + guildId]`). This prevents unexpected property lookups on the Worker `env` object.

---

## Cross-Guild Session Isolation

Even if guild context were somehow spoofed, cross-guild data access is prevented by construction:

- **Sessions are per-database.** A session created in guild A's DB does not exist in guild B's DB. If a request is routed to the wrong DB, `requireAuth` fails to find the session and returns 401.
- **Auth tokens are per-database.** A token created for guild A (stored in guild A's DB) cannot be consumed from guild B's DB. Tampering with the `guild` query param during the auth callback causes the token lookup to fail.
- **The worst case for cookie tampering is self-denial.** If a user modifies their `guild_id` cookie via devtools, their session won't be found in the new DB, and they get 401 until they re-authenticate.

---

## CORS

- **Production** (HTTPS): same-origin only
- **Development** (HTTP): allows `localhost:5173` and `localhost:8787`

---

## Security Headers

All responses include:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`

---

## Middleware Stack

1. **Error handler** - catches unhandled errors, redacts messages by default
2. **CORS** - dynamic origin (same-origin in production, localhost in dev)
3. **Security headers** - nosniff, frame deny, referrer policy
4. **Guild middleware** - resolves per-guild D1 binding from request context
5. **Foreign keys** - enables `PRAGMA foreign_keys = ON` per API request
6. **Bot auth** (`requireBotAuth`) - validates `X-Bot-Token` against `BOT_API_KEY`
7. **Session auth** (`requireAuth`) - validates `session_id` cookie

---

## Input Validation

| Field | Limit |
|-------|-------|
| `discord_id` | 1-30 chars (Zod validated) |
| `discord_username` | 1-50 chars (Zod validated) |
| `avatar_url` | max 500 chars |
| Game `name` | max 100 chars |
| Game `image_url` | max 500 chars |
| Rally `message` | max 500 chars |
| Gather `message` | max 500 chars |
| Gather `target_user_ids` | max 20 users |
| Shame `reason` | max 200 chars |

---

## Error Redaction

By default, unhandled errors return a generic "Internal server error" message. To expose full error details for debugging, set `VERBOSE_ERRORS=1` as a Cloudflare Worker secret or environment variable. This should never be enabled in production.

---

## Data Privacy

- `GET /api/games/:id/votes` strips `user_id` from the response
- `GET /api/availability` scopes `user_id` param to the authenticated user (no cross-user personal data access without a date filter)

---

## Attack Surface

The bot process has no inbound ports and initiates all connections itself, so the network attack surface on the bot host is effectively zero.

**`DISCORD_TOKEN` leaking.** An attacker can impersonate the bot on Discord: read messages, send messages, run commands. Keep it only in `.env` (which must be gitignored). If leaked, regenerate immediately in the Discord Developer Portal.

**`BOT_API_KEY` leaking.** An attacker can call bot-authenticated endpoints: read pending rally actions and gather pings, mark them as delivered (silently dropping notifications). They cannot write new actions or access user data beyond what those polling endpoints return. Rotate by generating a new 64-char hex key and updating both sides.

**`.env` committed to git.** The most common real-world mistake. Confirm `.env` is in `.gitignore` before the first commit. If it was ever committed, treat both secrets as compromised and rotate them.

**Bot host compromise.** A compromised host gives an attacker access to in-memory secrets. Standard host hardening applies; no additional when2play-specific mitigations needed beyond keeping the host patched.

---

## Shared Secrets Summary

Both the bot and server share exactly one secret: `BOT_API_KEY`.

| Variable | Where set | Description |
|----------|-----------|-------------|
| `BOT_API_KEY` | Bot `.env`, Server `wrangler secret` | Shared 64-char hex key; must match exactly |
| `DISCORD_TOKEN` | Bot `.env` only | Discord bot token |
| `WHEN2PLAY_API_URL` | Bot `.env` only | Base URL of the server |
| `GAMING_CHANNEL_ID` | Bot `.env`, optional | Fallback Discord channel ID |

`X-Guild-Id` is **not a secret**. It is a Discord guild snowflake (public identifier) sent as a plain header. The Worker only trusts it from bot-authenticated requests.
