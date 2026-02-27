# when2play — Software Design Document

## 1. Purpose

**when2play** is an asynchronous game-session scheduling app for friend groups. It integrates with Discord: a bot sends one-time auth links, users open a browser-based dashboard to propose games, rank-vote on what to play, set availability windows, ring a "gather bell" when ready to play, and lightly shame no-shows.

### Core User Flow

1. Discord bot sends a one-time auth link to a user via DM
2. User clicks link → browser opens → session cookie set → redirected to dashboard
3. On the dashboard, users can:
   - **Propose games** (via Steam name search, App ID lookup, or manual entry)
   - **Rank-vote** on proposed games (drag-to-reorder ranking)
   - **Set availability** (15-min time slots for today/tomorrow, vertical layout with dual timezone)
   - **Ring the gather bell** (notify others, with anonymous + targeted options)
   - **Rally** (call/in/out/ping/brb/where — structured session coordination)
   - **Gaming tree** (visualize the day's rally interactions as a DAG)
   - **Shame no-shows** (any user, with reasons)
   - **Blog** (articles about the system)
4. The dashboard shows a schedule summary: top-ranked games + overlap windows (with UTC + local times) + who's around

---

## 2. Architecture

### Stack

| Layer | Technology |
|-------|-----------|
| Backend | Hono on Cloudflare Workers |
| Database | Cloudflare D1 (SQLite) |
| Frontend | Preact + Vite SPA |
| Auth | One-time token → session cookie |
| Bot Auth | `X-Bot-Token` header → `BOT_API_KEY` secret |
| Styling | CSS custom properties with 5 switchable themes |

### Monorepo Structure

```
when2play/
├── Makefile        # Project commands (make help)
├── docs/           # Documentation
├── migrations/     # D1 SQL migrations (0000-0016)
├── shared/         # Shared TypeScript types (npm workspace)
├── src/            # Backend (Hono API)
│   ├── middleware/  # error, cors, auth, bot-auth, security-headers, fk
│   ├── routes/     # auth, users, games, votes, steam, availability, gather, shame, settings, rally
│   ├── db/queries/ # Database query functions
│   └── lib/        # crypto, time, steam utilities
├── frontend/       # Preact + Vite SPA (npm workspace)
│   └── src/
│       ├── hooks/      # useAuth, useTheme, useMediaQuery
│       ├── lib/        # time (dual timezone formatting)
│       ├── styles/     # global.css, themes.css
│       └── components/ # layout, games, availability, gather, shame, schedule, rally, tree, blog, ui
├── scripts/        # Dev/seed/simulate scripts
└── test/           # Backend tests (vitest)
```

### Data Flow

```
Discord Bot ──POST /api/auth/token───────► Worker API ──D1──► SQLite
Discord Bot ──POST /api/auth/admin-token─►     ▲
  (X-Bot-Token header)                         │
Browser SPA ──fetch /api/*───────────────────┘
  (session_id cookie)
```

---

## 3. Database Schema

All times stored in **UTC**. SQLite booleans use `INTEGER` (0/1). Foreign keys enforced via `PRAGMA foreign_keys = ON` per-request.

### users

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| discord_id | TEXT UNIQUE NOT NULL | Discord user ID |
| discord_username | TEXT NOT NULL | Server nickname from Discord |
| display_name | TEXT | Optional override name shown in the app (max 50 chars) |
| sync_name_from_discord | INTEGER DEFAULT 1 | If 1, `discord_username` auto-updates on next login |
| avatar_url | TEXT | Discord avatar |
| timezone | TEXT DEFAULT 'UTC' | IANA timezone |
| time_granularity_minutes | INTEGER DEFAULT 15 | User-adjustable slot size |
| created_at | TEXT NOT NULL | ISO 8601 |
| updated_at | TEXT NOT NULL | ISO 8601 |

### auth_tokens

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| token | TEXT UNIQUE NOT NULL | One-time token |
| user_id | TEXT NOT NULL FK→users | |
| expires_at | TEXT NOT NULL | 10-min expiry |
| used | INTEGER DEFAULT 0 | Boolean |
| is_admin | INTEGER DEFAULT 0 | Boolean — 1 when created via `/api/auth/admin-token` |
| created_at | TEXT NOT NULL | |

### sessions

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| session_id | TEXT UNIQUE NOT NULL | Cookie value |
| user_id | TEXT NOT NULL FK→users | |
| expires_at | TEXT NOT NULL | 7-day expiry (regular) or 1-hour expiry (admin) |
| is_admin | INTEGER DEFAULT 0 | Boolean — propagated from auth token |
| created_at | TEXT NOT NULL | |

### games

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| name | TEXT NOT NULL | Game title (max 100 chars) |
| steam_app_id | TEXT | Nullable |
| image_url | TEXT | Steam header or custom (max 500 chars) |
| proposed_by | TEXT NOT NULL FK→users | |
| is_archived | INTEGER DEFAULT 0 | Boolean |
| created_at | TEXT NOT NULL | |
| archived_at | TEXT | When archived |

### game_votes

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| game_id | TEXT NOT NULL FK→games | |
| user_id | TEXT NOT NULL FK→users | |
| rank | INTEGER NOT NULL | 1 = top pick |
| is_approved | INTEGER DEFAULT 1 | Approval toggle |
| created_at | TEXT NOT NULL | |
| UNIQUE(game_id, user_id) | | One vote per user per game |

### availability

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| user_id | TEXT NOT NULL FK→users | |
| date | TEXT NOT NULL | ISO date (YYYY-MM-DD) |
| start_time | TEXT NOT NULL | HH:MM (UTC) |
| end_time | TEXT NOT NULL | HH:MM (UTC) |
| created_at | TEXT NOT NULL | |
| UNIQUE(user_id, date, start_time) | | No duplicate slots |

### gather_pings

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| user_id | TEXT NOT NULL FK→users | Who rang |
| message | TEXT | Optional message (max 500 chars) |
| delivered | INTEGER DEFAULT 0 | Bot has picked up |
| is_anonymous | INTEGER DEFAULT 0 | Hide sender identity |
| target_user_ids | TEXT | JSON array of user IDs, NULL = all |
| created_at | TEXT NOT NULL | |

### shame_votes

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| voter_id | TEXT NOT NULL FK→users | Who shames |
| target_id | TEXT NOT NULL FK→users | Who is shamed |
| reason | TEXT | Optional reason (max 200 chars) |
| is_anonymous | INTEGER DEFAULT 0 | If 1, voter identity is hidden |
| created_at | TEXT NOT NULL | |
| UNIQUE(voter_id, target_id, created_at) | | One shame per pair per day (enforced in query layer) |

### settings

| Column | Type | Notes |
|--------|------|-------|
| key | TEXT PK | Setting name |
| value | TEXT NOT NULL | JSON-encoded value |
| updated_at | TEXT NOT NULL | |

Default settings:

| Key | Default | Description |
|-----|---------|-------------|
| `time_granularity_minutes` | `15` | Availability slot resolution (admin + user configurable) |
| `game_pool_lifespan_days` | `7` | Games older than this are auto-archived |
| `gather_cooldown_seconds` | `10` | Minimum seconds between a user's gather pings (0 = off) |
| `gather_hourly_limit` | `30` | Max pings per user per rolling 60-minute window (0 = off) |
| `day_reset_hour_et` | `8` | Hour (ET) at which the rally day resets (8 = 8 AM ET) |
| `avail_start_hour_et` | `17` | First hour shown in the availability grid (5 PM ET) |
| `avail_end_hour_et` | `3` | Last hour shown in the availability grid (3 AM ET next day) |
| `rally_button_labels` | `{}` | Admin-overridable labels for each rally button |
| `rally_suggested_phrases` | `{}` | Quick-pick phrases per rally action type |
| `rally_show_discord_command` | `true` | Show the Discord slash command name under each rally button |

### rallies

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| creator_id | TEXT NOT NULL FK→users | Who started the rally |
| timing | TEXT DEFAULT 'now' | 'now' or 'later' |
| day_key | TEXT UNIQUE NOT NULL | YYYY-MM-DD based on ET day boundary |
| status | TEXT DEFAULT 'open' | 'open' or 'closed' |
| created_at | TEXT NOT NULL | |

One rally per day. Day boundary: 8:01 AM ET → 8:00 AM next day ET (configurable via `day_reset_hour_et` setting).

### rally_actions

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| rally_id | TEXT FK→rallies | Nullable for orphan actions |
| actor_id | TEXT NOT NULL FK→users | Who performed the action |
| action_type | TEXT NOT NULL | call, in, out, ping, judge_time, judge_avail, brb, where, share_ranking |
| target_user_ids | TEXT | JSON array for ping/where/judge_avail |
| message | TEXT | Optional text |
| metadata | TEXT | JSON: judge results, timing info |
| delivered | INTEGER DEFAULT 0 | Whether bot has posted to Discord |
| day_key | TEXT NOT NULL | YYYY-MM-DD |
| created_at | TEXT NOT NULL | |

### rally_tree_shares

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| requested_by | TEXT NOT NULL FK→users | |
| day_key | TEXT NOT NULL | |
| image_data | TEXT | base64 PNG from frontend |
| delivered | INTEGER DEFAULT 0 | |
| created_at | TEXT NOT NULL | |

---

## 4. API Reference

### Auth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /api/auth/token | Bot (`X-Bot-Token`) | Create one-time auth token. Body: `{ discord_id: 1-30, discord_username: 1-50, avatar_url?: max 500 }` |
| POST | /api/auth/admin-token | Bot (`X-Bot-Token`) | Create one-time admin auth token (same body). Resulting session has `is_admin=1`, 1h TTL, browser-session cookie. |
| GET | /api/auth/callback/:token | None | Exchange token for session cookie. Admin tokens get no `Max-Age`. |
| POST | /api/auth/logout | Session | Destroy session |

### Users

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/users | Session | List all users (id, discord_username, avatar_url) |
| GET | /api/users/me | Session | Get current user (includes `is_admin: boolean`) |
| PATCH | /api/users/me | Session | Update timezone, display name, granularity |

### Games

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/games | Session | List active games (optional ?include_archived=true) |
| POST | /api/games | Session | Propose a game (name max 100, image_url max 500) |
| PATCH | /api/games/:id | Session | Update game (owner only) |
| DELETE | /api/games/:id | Session | Archive a game (owner only) |

### Votes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| PUT | /api/games/:id/vote | Session | Set rank + approval for a game |
| DELETE | /api/games/:id/vote | Session | Remove vote |
| GET | /api/games/:id/votes | Session | Get votes for a game (user_id stripped) |
| GET | /api/games/ranking | Session | Aggregated Borda count ranking |
| GET | /api/games/my-votes | Session | Current user's votes with game data |
| PUT | /api/games/reorder-votes | Session | Bulk rank update: `{ rankings: [{ game_id, rank }] }` |

### Steam

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/steam/search?q=QUERY | Session | Search Steam by name (2-100 chars, returns top 10) |
| GET | /api/steam/lookup/:appId | None | Lookup game info by Steam App ID |

### Availability

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/availability | Session | Get slots (?user_id, ?date). user_id scoped to self without date filter |
| PUT | /api/availability | Session | Set availability slots (bulk replace for a date) |
| DELETE | /api/availability | Session | Clear slots for a date |

### Gather

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /api/gather | Session | Ring the bell. Body: `{ message?, is_anonymous?, target_user_ids? }`. Rate-limited: hourly limit (default 30/h) + per-ping cooldown (default 10s). |
| GET | /api/gather/pending | Bot (`X-Bot-Token`) | Get undelivered pings (includes is_anonymous, target_user_ids) |
| PATCH | /api/gather/:id/delivered | Bot (`X-Bot-Token`) | Mark ping as delivered |

### Shame

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /api/shame/:targetId | Session | Shame a user (reason max 200 chars) |
| GET | /api/shame/leaderboard | Session | Get leaderboard with recent reasons |

### Rally

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /api/rally/call | Session | Create rally + call action. Body: `{ timing?: "now"\|"later" }` |
| POST | /api/rally/action | Session | Record action. Body: `{ action_type, target_user_ids?, message? }` |
| POST | /api/rally/judge/time | Session | Compute overlapping availability windows for today (all users with availability, 2+ overlap) |
| POST | /api/rally/share-ranking | Session | Broadcast current game ranking to Discord |
| POST | /api/rally/judge/avail | Session | Nudge user to set availability. Body: `{ target_user_ids }` |
| GET | /api/rally/active | Session | Get today's rally + actions (?day_key optional) |
| GET | /api/rally/tree | Session | Get tree DAG data (?day_key optional) |
| GET | /api/rally/pending | Bot (`X-Bot-Token`) | Poll undelivered rally actions |
| PATCH | /api/rally/:id/delivered | Bot (`X-Bot-Token`) | Mark rally action delivered |
| POST | /api/rally/tree/share | Session | Upload base64 PNG for Discord sharing |
| GET | /api/rally/tree/share/pending | Bot (`X-Bot-Token`) | Poll pending tree images |
| PATCH | /api/rally/tree/share/:id/delivered | Bot (`X-Bot-Token`) | Mark tree share delivered |

### Settings

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/settings | Session | Get all settings |
| PATCH | /api/settings | Session (admin) | Update settings (requires `is_admin` session flag from admin-token flow) |

### Health

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/health | None | Health check |

### Response Format

All endpoints return:

```json
{
  "ok": true,
  "data": { ... }
}
```

Or on error:

```json
{
  "ok": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Game not found"
  }
}
```

Error messages are redacted in production (HTTPS) for unhandled errors.

---

## 5. Voting: Borda Count

- Users drag games into their preferred order via the **VoteRanking** component (rank 1 = top pick)
- Users can toggle "approved" on/off per game (approval voting layer)
- **Borda scoring**: With N ranked games, rank 1 gets N points, rank 2 gets N-1, etc.
- Only approved games accumulate points
- Games with fewer than 2 votes show "needs more votes"
- Ranking endpoint returns games sorted by total Borda score descending
- Bulk reorder via `PUT /api/games/reorder-votes` persists drag-and-drop changes

---

## 6. Frontend Layout

### Pages

1. **AuthCallback** (`/auth/:token`) — exchanges token, redirects to home
2. **Home** (`/`) — main dashboard (requires auth)
3. **NotFound** — 404 fallback

### Responsive Layout

**Desktop** (>768px):

```
┌──────────────────────────────────────────────┐
│  Header: logo + theme picker + user + logout │
├──────────┬───────────────────────────────────┤
│          │  Main Content Area               │
│ Sidebar  │  (changes based on sidebar nav)   │
│ - Sched  │                                   │
│ - Games  │                                   │
│ - Avail  │                                   │
│ - Gather │                                   │
│ - Rally  │                                   │
│ - Tree   │                                   │
│ - Shame  │                                   │
│ - Blog   │                                   │
└──────────┴───────────────────────────────────┘
```

**Mobile** (<=768px):

```
┌──────────────────────────────┐
│ Header: logo + themes + ava  │
├──────────────────────────────┤
│                              │
│  Main Content Area           │
│  (full width, 16px padding)  │
│                              │
├──────────────────────────────┤
│ BottomNav: 8 tabs with icons │
└──────────────────────────────┘
```

- Header hides username on mobile, shows avatar only
- Buttons have 44px min touch targets
- Input font-size 16px (prevents iOS zoom)
- `viewport-fit=cover` for safe-area support

### Themes

The theme system has two independent dimensions:

**Mode** (light / dark): toggled via ☀/☾ buttons in the header. Persisted in `localStorage('w2p-mode')`. Applied via `data-mode="light"` attribute on `<html>`. Light mode overrides background, text, and border CSS variables.

**Color scheme** (5 accents): selected via colored circles in the header. Persisted in `localStorage('w2p-theme')`. Applied via `data-theme` attribute. A checkmark (✓) appears on the active circle.

| Scheme | Accent | Vibe |
|--------|--------|------|
| **Midnight** (default) | #3b82f6 (blue) | Dark blue |
| **Cyberpunk** | #ff2a6d (neon pink) | Neon on purple |
| **Forest** | #2ecc71 (emerald) | Earthy greens |
| **Sakura** | #e891b9 (soft pink) | Lavender pink |
| **Amber** | #f59e0b (gold) | Warm on charcoal |

Both settings are independent and compose: any accent works in both light and dark mode. `initTheme()` runs before first render to prevent flash.

### Dual Timezone Display

All time displays show both UTC and local time:
- Schedule Summary header: "Times in UTC (your timezone: America/New_York)"
- Availability header: same
- Time slots: `"19:00 UTC / 2:00 PM"`
- TimeGrid hour headers: `"19:00 UTC / 2:00 PM"`

### Key Components

- **TimeGrid**: Vertical single-column layout with hour group headers. Touch support via "Select mode" / "Scroll mode" toggle on mobile.
- **ProposeGameForm**: Steam name search (300ms debounce, dropdown results), App ID lookup, or manual entry.
- **VoteRanking**: Drag-to-reorder ranking list. Add games from unranked pool, remove from ranking. Auto-saves order.
- **GatherBell**: Anonymous checkbox, Everyone/Specific user toggle, multi-select user picker with avatars.
- **ShameWall**: Shows all users (not just those with shames). Per-target expand/collapse with inline reason input. Leaderboard shows latest 3 reasons.
- **RallyPanel**: Action buttons grid (call/in/out/ping/brb/where/call2select/post schedule/post gamerank). User selector for targeted actions. Live action feed with auto-refresh. Admin-configurable button labels and suggested phrases.
- **GamingTree**: Day selector, dagre-based SVG DAG renderer with pan/zoom, SVG→PNG export for Discord sharing.
- **TreeVisualization**: Left-to-right DAG layout via `@dagrejs/dagre`. Color-coded nodes by action type, cubic bezier edges (solid = response, dashed = ping).
- **ActionFeed**: Scrollable, color-coded list of today's rally actions with auto-scroll to latest.
- **BlogPage**: Static blog post about the TCP handshake parallel in gaming coordination.

---

## 7. Security

### Middleware Stack

1. **Error handler** — catches unhandled errors, redacts messages in production
2. **CORS** — dynamic origin (same-origin in production, localhost in dev)
3. **Security headers** — `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`
4. **Foreign keys** — enables `PRAGMA foreign_keys = ON` per API request
5. **Bot auth** (`requireBotAuth`) — validates `X-Bot-Token` against `BOT_API_KEY` secret
6. **Session auth** (`requireAuth`) — validates `session_id` cookie

### Input Validation

- Auth token creation: Zod schema (discord_id 1-30, discord_username 1-50, avatar_url optional max 500)
- Game name: max 100 chars
- Game image_url: max 500 chars
- Gather message: max 500 chars
- Gather target_user_ids: max 20 entries
- Shame reason: max 200 chars
- Rally action message: max 500 chars
- Rally action target_user_ids: required for ping/where
- Steam search query: 2-100 chars

### Access Control

- Settings PATCH: admin only — session must carry `is_admin=1`, set by the admin-token flow (Discord ADMINISTRATOR permission gated at the bot)
- Game votes: `user_id` stripped from public response
- Availability: `user_id` param scoped to authenticated user without date filter

---

## 8. Discord Bot Contract

The Discord bot is **not implemented** in this repo. See `docs/SETUP.md` for a complete working example.

### Bot-Facing Endpoints

All require `X-Bot-Token` header (matching `BOT_API_KEY` Cloudflare secret):

| Endpoint | Description |
|----------|-------------|
| `POST /api/auth/token` | Create regular auth link. Body: `{ discord_id, discord_username, avatar_url? }` |
| `POST /api/auth/admin-token` | Create admin auth link (same body). Bot must verify `ADMINISTRATOR` permission before calling. |
| `GET /api/gather/pending` | Poll for undelivered gather pings |
| `PATCH /api/gather/:id/delivered` | Mark gather ping as delivered |
| `GET /api/rally/pending` | Poll for undelivered rally actions |
| `PATCH /api/rally/:id/delivered` | Mark rally action as delivered |
| `GET /api/rally/tree/share/pending` | Poll for pending tree share images |
| `PATCH /api/rally/tree/share/:id/delivered` | Mark tree share as delivered |

### Gather Ping Fields

When polling `GET /api/gather/pending`, each ping includes:
- `sender_discord_id` (string) — numeric Discord ID of the sender, pre-resolved. Use `<@id>` directly.
- `sender_username` (string) — display name of the sender
- `is_anonymous` (boolean) — if true, hide the sender's identity
- `target_discord_ids` (string[] | null) — if non-null, numeric Discord IDs to mention. Pre-resolved server-side — no bot-side mapping needed.

---

## 9. Key Technical Decisions

- **Time granularity**: 15-min default, admin-adjustable globally via settings, user-adjustable individually
- **Game pool lifespan**: 7 days; expired games auto-archived but remain visible with `?include_archived=true`
- **Session cleanup**: Lazy — expired tokens/sessions deleted on access. No cron trigger for MVP.
- **Cookie config**: `session_id=...; HttpOnly; SameSite=Strict; Path=/`. `Secure` flag only in production. Regular sessions include `Max-Age=604800` (7 days). Admin sessions omit `Max-Age` (browser-session) and DB row expires after 1 hour.
- **CORS**: Production = same-origin. Dev = `localhost:5173` + `localhost:8787`.
- **Bot auth**: `X-Bot-Token` header validated against `BOT_API_KEY` secret. Skipped when secret is unset (local dev).
- **Error redaction**: Production returns generic error messages. Dev returns full error details.
- **Theme persistence**: `localStorage('w2p-theme')` (color scheme) and `localStorage('w2p-mode')` (light/dark) with `initTheme()` before render to prevent flash.
- **Responsive breakpoint**: 768px. Below = BottomNav + mobile padding. Above = Sidebar + desktop layout.
- **Steam search**: Fetches `store.steampowered.com/search/suggest` HTML, parses with regex for app IDs, names, and images.
