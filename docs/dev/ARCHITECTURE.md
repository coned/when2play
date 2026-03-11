# Architecture & Design

## 1. Purpose

**when2play** is an asynchronous game-session scheduling app for friend groups. It integrates with Discord: a bot sends one-time auth links, users open a browser-based dashboard to propose games, rank-vote on what to play, set availability windows, ring a "gather bell" when ready to play, and lightly shame no-shows.

### Core User Flow

1. Discord bot sends a one-time auth link to a user via DM
2. User clicks link, browser opens, session cookie set, redirected to dashboard
3. On the dashboard, users can:
   - **Propose games** (via Steam name search, App ID lookup, or manual entry)
   - **Rank-vote** on proposed games (drag-to-reorder ranking)
   - **Set availability** (15-min time slots for a 10-day window, auto-seeded from last week, with per-slot status tracking)
   - **Ring the gather bell** (notify others, with anonymous + targeted options)
   - **Rally** (call/in/out/ping/brb/where - structured session coordination)
   - **Gaming tree** (visualize the day's rally interactions as a DAG)
   - **Shame no-shows** (any user, with reasons)
   - **Blog** (articles about the system)
4. The dashboard shows a schedule summary: top-ranked games + overlap windows (with UTC + local times) + who's around

---

## 2. Stack

| Layer | Technology |
|-------|-----------|
| Backend | Hono on Cloudflare Workers |
| Database | Cloudflare D1 (SQLite) |
| Frontend | Preact + Vite SPA |
| Auth | One-time token to session cookie |
| Bot Auth | `X-Bot-Token` header validated against `BOT_API_KEY` secret |
| Styling | CSS custom properties with 5 switchable themes |

---

## 3. Monorepo Structure

```
when2play/
├── Makefile        # Project commands (make help)
├── docs/           # Documentation
├── migrations/     # D1 SQL migrations (consolidated into 0000)
├── shared/         # Shared TypeScript types (npm workspace)
├── src/            # Backend (Hono API)
│   ├── middleware/  # error, cors, auth, bot-auth, security-headers, fk, guild
│   ├── routes/     # auth, users, games, votes, steam, availability, gather, shame, settings, rally, guilds
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

---

## 4. Data Flow

```
Discord Bot ──POST /api/auth/token────────► Worker API ──D1──► SQLite
Discord Bot ──POST /api/auth/admin-token──►     ▲
  (X-Bot-Token + X-Guild-Id headers)            │
Browser SPA ──fetch /api/*──────────────────────┘
  (session_id + guild_id cookies)
```

---

## 5. Multi-Guild Architecture

Each Discord guild gets its own isolated D1 database. A single Worker holds multiple D1 bindings (`DB_<guild_id>`) and a middleware selects the right one per request.

```
Discord Gateway (WebSocket)
        |
   bot.mjs (single instance)
        |
        +-- X-Guild-Id: 111... ---+
        +-- X-Guild-Id: 333... ---+--> Single Worker
        +-- X-Guild-Id: 555... ---+        |
                                      guild middleware
                                      resolves DB binding
                                           |
                                    +------+------+
                                    |      |      |
                                  D1_111 D1_333 D1_555
```

One bot, one Worker deployment, one API URL, one `BOT_API_KEY`. Guild isolation happens at the database layer.

### Why this approach

Three options were considered:

| | (A) Single DB + guild_id columns | (B) Separate Worker per guild | (C) Single Worker + multi-D1 |
|---|---|---|---|
| **Isolation** | Row-level (error-prone) | Full stack | DB-level |
| **Schema changes** | Every table needs guild_id | None | None |
| **Deployments** | 1 | N Workers, N URLs, N API keys | 1 |
| **Operational complexity** | Low | High | Low |

Option **(C) wins**: one deployment, one URL, one API key. DB-level isolation with zero changes to any query function, since every query already accepts `db: D1Database` as a parameter. The middleware swaps `c.env.DB` before the request reaches any route.

**Trade-off**: all guilds share the same Worker's rate limits and availability. For when2play's scale (small friend groups, low traffic), this is acceptable.

### Guild DB routing middleware

The middleware resolves guild context from:
1. `X-Guild-Id` header - trusted only when `X-Bot-Token` is valid (bot requests)
2. `guild` query parameter - used during the auth callback redirect (browser)
3. `guild_id` cookie - set after auth, used by subsequent browser requests

The guild ID is validated as a Discord snowflake (`/^\d{17,20}$/`) before being used as a dynamic property key. If a per-guild binding (`DB_<guildId>`) exists, it is used; otherwise the Worker falls back to the default `DB` binding.

### Effect on routes and queries

**None.** Every route reads `c.env.DB`. Every query function accepts `db: D1Database`. The middleware swaps the binding before any route runs. Zero changes to route handlers or query functions.

---

## 6. Database Schema

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
| user_id | TEXT NOT NULL FK>users | |
| expires_at | TEXT NOT NULL | 10-min expiry |
| used | INTEGER DEFAULT 0 | Boolean |
| is_admin | INTEGER DEFAULT 0 | 1 when created via `/api/auth/admin-token` |
| created_at | TEXT NOT NULL | |

### sessions

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| session_id | TEXT UNIQUE NOT NULL | Cookie value |
| user_id | TEXT NOT NULL FK>users | |
| expires_at | TEXT NOT NULL | 7-day expiry (regular) or 1-hour expiry (admin) |
| is_admin | INTEGER DEFAULT 0 | Propagated from auth token |
| created_at | TEXT NOT NULL | |

### games

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| name | TEXT NOT NULL | Game title (max 100 chars) |
| steam_app_id | TEXT | Nullable |
| image_url | TEXT | Steam header or custom (max 500 chars) |
| proposed_by | TEXT NOT NULL FK>users | |
| is_archived | INTEGER DEFAULT 0 | Boolean |
| created_at | TEXT NOT NULL | |
| archived_at | TEXT | When archived |
| archive_reason | TEXT | 'not_interested', 'save_for_later', 'auto_archived', etc. |
| image_checked_at | TEXT | Last time the image URL was validated against Steam CDN |
| note | TEXT | Optional user note (max 500 chars) |
| last_activity_at | TEXT | Updated on propose, react, restore, share; used for auto-archive |

### game_votes

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| game_id | TEXT NOT NULL FK>games | |
| user_id | TEXT NOT NULL FK>users | |
| rank | INTEGER NOT NULL | 1 = top pick |
| is_approved | INTEGER DEFAULT 1 | Approval toggle |
| created_at | TEXT NOT NULL | |
| UNIQUE(game_id, user_id) | | One vote per user per game |

### availability

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| user_id | TEXT NOT NULL FK>users | |
| date | TEXT NOT NULL | ISO date (YYYY-MM-DD) |
| start_time | TEXT NOT NULL | HH:MM (UTC) |
| end_time | TEXT NOT NULL | HH:MM (UTC) |
| created_at | TEXT NOT NULL | |
| slot_status | TEXT DEFAULT 'available' | 'available' or 'tentative' |
| UNIQUE(user_id, date, start_time) | | No duplicate slots |

### availability_status

Per-user, per-date status tracking for the availability window.

| Column | Type | Notes |
|--------|------|-------|
| user_id | TEXT NOT NULL FK>users | |
| date | TEXT NOT NULL | ISO date |
| status | TEXT NOT NULL | 'tentative_auto', 'tentative_confirmed', or 'filled' |
| updated_at | TEXT NOT NULL | |
| PRIMARY KEY(user_id, date) | | One status per user per date |

### gather_pings

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| user_id | TEXT NOT NULL FK>users | Who rang |
| message | TEXT | Optional message (max 500 chars) |
| delivered | INTEGER DEFAULT 0 | Bot has picked up |
| is_anonymous | INTEGER DEFAULT 0 | Hide sender identity |
| target_user_ids | TEXT | JSON array of user IDs, NULL = all |
| created_at | TEXT NOT NULL | |

### shame_votes

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| voter_id | TEXT NOT NULL FK>users | Who shames |
| target_id | TEXT NOT NULL FK>users | Who is shamed |
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
| `auto_archive_enabled` | `true` | Whether stale games are auto-archived on pool fetch |
| `game_pool_lifespan_days` | `7` | Days of inactivity before auto-archive |
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
| creator_id | TEXT NOT NULL FK>users | Who started the rally |
| timing | TEXT DEFAULT 'now' | 'now' or 'later' |
| day_key | TEXT UNIQUE NOT NULL | YYYY-MM-DD based on ET day boundary |
| status | TEXT DEFAULT 'open' | 'open' or 'closed' |
| created_at | TEXT NOT NULL | |

One rally per day. Day boundary: 8:01 AM ET to 8:00 AM next day ET (configurable via `day_reset_hour_et` setting).

### rally_actions

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| rally_id | TEXT FK>rallies | Nullable for orphan actions |
| actor_id | TEXT NOT NULL FK>users | Who performed the action |
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
| requested_by | TEXT NOT NULL FK>users | |
| day_key | TEXT NOT NULL | |
| image_data | TEXT | base64 PNG from frontend |
| delivered | INTEGER DEFAULT 0 | |
| created_at | TEXT NOT NULL | |

### game_shares

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| game_id | TEXT NOT NULL FK>games | ON DELETE CASCADE |
| requested_by | TEXT NOT NULL FK>users | ON DELETE CASCADE |
| delivered | INTEGER DEFAULT 0 | Bot has picked up |
| created_at | TEXT NOT NULL | |

---

## 7. Voting: Borda Count

- Users drag games into their preferred order via the **VoteRanking** component (rank 1 = top pick)
- Users can toggle "approved" on/off per game (approval voting layer)
- **Borda scoring**: With N ranked games, rank 1 gets N points, rank 2 gets N-1, etc.
- Only approved games accumulate points
- Games with fewer than 2 votes show "needs more votes"
- Ranking endpoint returns games sorted by total Borda score descending
- Bulk reorder via `PUT /api/games/reorder-votes` persists drag-and-drop changes

---

## 8. Frontend Layout

### Pages

1. **AuthCallback** (`/auth/:token`) - exchanges token, redirects to home
2. **Home** (`/`) - main dashboard (requires auth)
3. **NotFound** - 404 fallback

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

**Mode** (light / dark): toggled via sun/moon buttons in the header. Persisted in `localStorage('w2p-mode')`. Applied via `data-mode="light"` attribute on `<html>`. Light mode overrides background, text, and border CSS variables.

**Color scheme** (5 accents): selected via colored circles in the header. Persisted in `localStorage('w2p-theme')`. Applied via `data-theme` attribute. A checkmark appears on the active circle.

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
- **GamingTree**: Day selector, dagre-based SVG DAG renderer with pan/zoom, SVG-to-PNG export for Discord sharing.
- **TreeVisualization**: Left-to-right DAG layout via `@dagrejs/dagre`. Color-coded nodes by action type, cubic bezier edges (solid = response, dashed = ping).
- **ActionFeed**: Scrollable, color-coded list of today's rally actions with auto-scroll to latest.
- **BlogPage**: Static blog post about the TCP handshake parallel in gaming coordination.

---

## 9. Key Technical Decisions

- **Time granularity**: 15-min default, admin-adjustable globally via settings, user-adjustable individually
- **Game pool lifespan**: 7 days; expired games auto-archived but remain visible with `?include_archived=true`
- **Session cleanup**: Lazy - expired tokens/sessions deleted on access. No cron trigger for MVP.
- **Cookie config**: `session_id=...; HttpOnly; SameSite=Strict; Path=/`. `Secure` flag only in production. Regular sessions include `Max-Age=604800` (7 days). Admin sessions omit `Max-Age` (browser-session) and DB row expires after 1 hour.
- **CORS**: Production = same-origin. Dev = `localhost:5173` + `localhost:8787`.
- **Bot auth**: `X-Bot-Token` header validated against `BOT_API_KEY` secret. Skipped when secret is unset (local dev).
- **Error redaction**: Generic error messages by default. Set `VERBOSE_ERRORS=1` to expose full error details for debugging.
- **Theme persistence**: `localStorage('w2p-theme')` (color scheme) and `localStorage('w2p-mode')` (light/dark) with `initTheme()` before render to prevent flash.
- **Responsive breakpoint**: 768px. Below = BottomNav + mobile padding. Above = Sidebar + desktop layout.
- **Steam search**: Fetches `store.steampowered.com/search/suggest` HTML, parses with regex for app IDs, names, and images.
- **Image refresh**: Stale-while-revalidate pattern. Steam game images are re-validated via HEAD requests to the CDN every 24 hours, up to 3 per page load, using `waitUntil()` for zero user-facing latency. Failures defer the next check by 24 hours.

### Day Boundaries

Gaming sessions often run past midnight, so the app uses three distinct "day" concepts:

| Concept | Setting | Default | Used by |
|---------|---------|---------|---------|
| **Game day** (day key) | `day_reset_hour_et` | 8 AM ET | Rally system (`day_key` in rallies and rally_actions). Before 8 AM ET, the game day is still "yesterday." |
| **Availability day** | `day_cutoff_hour_et` | 5 AM ET | Availability display and schedule summary. Before 5 AM ET, "today" in the availability context still means the previous calendar date. |
| **Calendar day** | N/A (user's local timezone) | midnight | Used for `+1` indicators on time slots that cross midnight in the user's local time. |

The game day and availability day boundaries prevent late-night gaming sessions from rolling over into the next day's data prematurely. For example, a session ending at 2 AM still belongs to the previous game day (since `day_reset_hour_et` defaults to 8 AM ET).
