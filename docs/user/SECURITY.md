# Security Reference

---

## Bot Authentication

Bot-facing endpoints require the `X-Bot-Token` header matching the `BOT_API_KEY` Cloudflare secret:

```
X-Bot-Token: <your-bot-api-key>
```

Set the secret via `npx wrangler secret put BOT_API_KEY` (locally: `BOT_API_KEY` in `.dev.vars`, see `.dev.vars.example`). The token is compared in constant time (`src/lib/bot-token.ts`: `crypto.subtle.timingSafeEqual` on Workers, a constant-time byte loop on Node) everywhere it is checked: `requireBotAuth`, the act-as path in `requireAuth`, the guild middleware and the bot branch of the auth callback.

**Fail closed.** If `BOT_API_KEY` is not configured on the server, `requireBotAuth` rejects every request with HTTP `503` and error code `BOT_AUTH_NOT_CONFIGURED`, whatever headers it carries, and the act-as and `X-Guild-Id` paths are never taken. There is no bypass flag. A wrong or missing token with the key configured gets `403 FORBIDDEN`.

Protected endpoints:
- `POST /api/bot/poll` - aggregated delivery poll for all guilds in one request (rally actions, tree shares, game shares); also carries the acks for items the bot already posted. Mounted outside the guild middleware: the guild IDs are in the body, not in `X-Guild-Id`
- `POST /api/users/sync` - upsert Discord users (id, username, avatar) before acting as them
- `POST /api/auth/token` - create login tokens for Discord users
- `POST /api/auth/admin-token` - create admin login tokens
- `GET /api/settings/bot` + `PATCH /api/settings/bot` - guild settings
- Legacy per-kind delivery endpoints, superseded by `POST /api/bot/poll`:
  - `GET /api/gather/pending` + `PATCH /api/gather/:id/delivered` - gather ping delivery
  - `GET /api/rally/pending` + `PATCH /api/rally/:id/delivered` - rally action delivery
  - `GET /api/rally/tree/share/pending` + `PATCH /api/rally/tree/share/:id/delivered` - tree image delivery
  - `GET /api/games/share/pending` + `PATCH /api/games/share/:id/delivered` - game ranking share delivery

### Acting as a user

The bot runs slash commands such as `/call` and `/in` on behalf of the Discord user who typed them. Instead of a session cookie it sends:

```
X-Bot-Token: <BOT_API_KEY>
X-Guild-Id: <guild snowflake>
X-Discord-User-Id: <discord user id>
```

`requireAuth` accepts this only when `BOT_API_KEY` is configured and the token matches. It then loads the user by `discord_id` from that guild's database (unknown user: `401`; the bot calls `POST /api/users/sync` first). Act-as requests are never admin and have no session. A request whose token does not match is treated like any cookie request, so a browser cannot use `X-Discord-User-Id`.

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

The `X-Guild-Id` header is only trusted when the request also carries a valid `X-Bot-Token`. The guild middleware verifies the bot token (a constant-time comparison against `c.env.BOT_API_KEY`, never true when the key is unset) before reading the header. This prevents browsers from spoofing guild context, since browsers can set arbitrary request headers via `fetch()`.

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

Two sources, because static assets never reach the Worker code (only `/api/*` runs the Worker first, see `run_worker_first` in `wrangler.jsonc.template`):

**API responses** (`/api/*`, `src/middleware/security-headers.ts`):
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`

**Static assets** (the HTML shell, JS, CSS, images; `frontend/public/_headers`, which Vite copies to `frontend/dist/_headers` and Cloudflare's static asset handler applies; the file itself is not served):
- `/*`: the same three headers plus
  `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data: blob:; connect-src 'self' https:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`
- `/assets/*`: `Cache-Control: public, max-age=31536000, immutable` (Vite puts a content hash in every file name there, so a new build gets new URLs; `index.html` keeps the default `max-age=0, must-revalidate`)

Why each CSP directive is set the way it is:

| Directive | Reason |
|-----------|--------|
| `script-src 'self'` | The built `index.html` loads one module script from `/assets/`; there is no inline script, `eval` or `new Function` |
| `style-src 'self' 'unsafe-inline'` | Components use inline `style` attributes; the stylesheet is same-origin, no web fonts are loaded |
| `img-src 'self' https: data: blob:` | Discord avatars, Steam header images and user supplied game image URLs (any https host); `data:` and `blob:` for the gaming tree PNG export, which embeds avatars as data URLs and rasterizes the SVG through a blob URL |
| `connect-src 'self' https:` | API calls are same-origin; the tree export fetches avatar images from their https hosts to embed them |
| `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'` | No framing, plugins, base tag or cross-origin form posts are needed |

If a change adds an external script, stylesheet, font, iframe or fetch target, update `frontend/public/_headers` in the same commit. Check the headers locally with `npx wrangler dev` and `curl -sI http://localhost:8787/`.

---

## Middleware Stack

1. **Error handler** - catches unhandled errors, redacts messages by default
2. **CORS** - dynamic origin (same-origin in production, localhost in dev)
3. **Security headers** - nosniff, frame deny, referrer policy
4. **Guild middleware** - resolves per-guild D1 binding from request context
5. **Foreign keys** - enables `PRAGMA foreign_keys = ON` per API request
6. **Bot auth** (`requireBotAuth`) - validates `X-Bot-Token` against `BOT_API_KEY` in constant time; `503` when the key is not configured
7. **Session auth** (`requireAuth`) - validates `session_id` cookie, or the act-as headers from the bot

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

**`BOT_API_KEY` leaking.** Treat this as a full compromise of the app: with the key and a guild ID an attacker can mint login links for any Discord user (`POST /api/auth/token`, and admin links via `POST /api/auth/admin-token`), act as any user through the act-as headers, and read or drop pending notifications via `POST /api/bot/poll`. Rotate immediately by generating a new 64-char hex key and updating both sides (see Maintenance, API Key Rotation).

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
