# when2play — Software Design Document

## 1. Purpose

**when2play** is an asynchronous game-session scheduling app for friend groups. It integrates with Discord: a bot sends one-time auth links, users open a browser-based dashboard to propose games, rank-vote on what to play, set availability windows, ring a "gather bell" when ready to play, and lightly shame no-shows.

### Core User Flow

1. Discord bot sends a one-time auth link to a user via DM
2. User clicks link → browser opens → session cookie set → redirected to dashboard
3. On the dashboard, users can:
   - **Propose games** (via Steam App ID or manual entry)
   - **Rank-vote** on proposed games (drag-and-drop ranking + approval toggle)
   - **Set availability** (15-min time slots for today/tomorrow)
   - **Ring the gather bell** (notify others you're ready to play)
   - **Shame no-shows** (light-hearted accountability)
4. The dashboard shows a schedule summary: top-ranked games + overlap windows + who's around

---

## 2. Architecture

### Stack

| Layer | Technology |
|-------|-----------|
| Backend | Hono on Cloudflare Workers |
| Database | Cloudflare D1 (SQLite) |
| Frontend | Preact + Vite SPA |
| Auth | One-time token → session cookie |
| Styling | CSS custom properties (dark gaming theme) |

### Monorepo Structure

```
when2play/
├── docs/           # Documentation
├── migrations/     # D1 SQL migrations
├── shared/         # Shared TypeScript types (npm workspace)
├── src/            # Backend (Hono API)
├── frontend/       # Preact + Vite SPA (npm workspace)
├── scripts/        # Dev/seed/simulate scripts
└── test/           # Backend tests (vitest)
```

### Data Flow

```
Discord Bot ──POST /api/auth/token──► Worker API ──D1──► SQLite
                                          ▲
Browser SPA ──fetch /api/*──────────────┘
```

---

## 3. Database Schema

All times stored in **UTC**. SQLite booleans use `INTEGER` (0/1). Foreign keys enforced via `PRAGMA foreign_keys = ON` per-request.

### users

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| discord_id | TEXT UNIQUE NOT NULL | Discord user ID |
| discord_username | TEXT NOT NULL | Display name |
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
| created_at | TEXT NOT NULL | |

### sessions

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| session_id | TEXT UNIQUE NOT NULL | Cookie value |
| user_id | TEXT NOT NULL FK→users | |
| expires_at | TEXT NOT NULL | 7-day expiry |
| created_at | TEXT NOT NULL | |

### games

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| name | TEXT NOT NULL | Game title |
| steam_app_id | TEXT | Nullable |
| image_url | TEXT | Steam header or custom |
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
| message | TEXT | Optional message |
| delivered | INTEGER DEFAULT 0 | Bot has picked up |
| created_at | TEXT NOT NULL | |

### shame_votes

| Column | Type | Notes |
|--------|------|-------|
| id | TEXT PK | UUID |
| voter_id | TEXT NOT NULL FK→users | Who shames |
| target_id | TEXT NOT NULL FK→users | Who is shamed |
| reason | TEXT | Optional reason |
| created_at | TEXT NOT NULL | |
| UNIQUE(voter_id, target_id, date) | | One shame per pair per day |

### settings

| Column | Type | Notes |
|--------|------|-------|
| key | TEXT PK | Setting name |
| value | TEXT NOT NULL | JSON-encoded value |
| updated_at | TEXT NOT NULL | |

Default settings: `time_granularity_minutes=15`, `game_pool_lifespan_days=7`, `gather_cooldown_minutes=30`.

---

## 4. API Reference

### Auth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /api/auth/token | Bot (deferred) | Create one-time auth token for a Discord user |
| GET | /api/auth/callback/:token | None | Exchange token for session cookie |
| POST | /api/auth/logout | Session | Destroy session |

### Users

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/users/me | Session | Get current user |
| PATCH | /api/users/me | Session | Update timezone, display name, granularity |

### Games

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/games | Session | List active games (optional ?include_archived=true) |
| POST | /api/games | Session | Propose a game |
| PATCH | /api/games/:id | Session | Update game (owner only) |
| DELETE | /api/games/:id | Session | Archive a game (owner only) |

### Votes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| PUT | /api/games/:id/vote | Session | Set rank + approval for a game |
| DELETE | /api/games/:id/vote | Session | Remove vote |
| GET | /api/games/:id/votes | Session | Get all votes for a game |
| GET | /api/games/ranking | Session | Aggregated Borda count ranking |

### Availability

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/availability | Session | Get slots (optional ?user_id, ?date) |
| PUT | /api/availability | Session | Set availability slots (bulk replace for a date) |
| DELETE | /api/availability | Session | Clear slots for a date |

### Gather

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /api/gather | Session | Ring the gather bell |
| GET | /api/gather/pending | Bot (deferred) | Get undelivered pings |
| PATCH | /api/gather/:id/delivered | Bot (deferred) | Mark ping as delivered |

### Shame

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /api/shame/:targetId | Session | Shame a user |
| GET | /api/shame/leaderboard | Session | Get shame leaderboard |

### Settings

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/settings | Session | Get all settings |
| PATCH | /api/settings | Session | Update settings (admin) |

### Steam

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | /api/steam/lookup/:appId | Session | Lookup game info from Steam |

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

---

## 5. Voting: Borda Count

- Users drag games into their preferred order (rank 1 = top pick)
- Users can toggle "approved" on/off per game (approval voting layer)
- **Borda scoring**: With N ranked games, rank 1 gets N points, rank 2 gets N-1, etc.
- Only approved games accumulate points
- Games with fewer than 2 votes show "needs more votes"
- Ranking endpoint returns games sorted by total Borda score descending

---

## 6. Frontend Layout

### Pages

1. **AuthCallback** (`/auth/:token`) — exchanges token, redirects to home
2. **Home** (`/`) — main dashboard (requires auth)
3. **NotFound** — 404 fallback

### Dashboard Sections (Home page)

```
┌──────────────────────────────────────────────┐
│  Header: when2play logo + user avatar        │
├──────────┬───────────────────────────────────┤
│          │  Schedule Summary                 │
│ Sidebar  │  (ranked games + overlap windows) │
│          ├───────────────────────────────────┤
│ - Games  │  Main Content Area               │
│ - Avail  │  (changes based on sidebar nav)   │
│ - Gather │                                   │
│ - Shame  │                                   │
│          │                                   │
└──────────┴───────────────────────────────────┘
```

### Theme

- Dark background (`#0f0f0f`)
- Accent color: electric blue (`#3b82f6`)
- Card surfaces: `#1a1a2e`
- Text: `#e0e0e0` / `#a0a0a0`
- Gaming-inspired, clean and minimal

---

## 7. Local Development

### Prerequisites

- Node.js 20+
- npm 10+
- Wrangler CLI

### Setup

```bash
npm install
npm run dev          # runs scripts/dev.sh
```

`scripts/dev.sh` runs:
- `wrangler dev --port 8787` (backend + D1 local)
- `cd frontend && npx vite --port 5173` (frontend)

Vite proxies `/api/*` → `http://localhost:8787`.

### Simulating Auth (No Bot)

```bash
bash scripts/simulate-bot.sh
# → Creates auth token
# → Prints: Open http://localhost:5173/auth/<token>
```

### Seeding Data

```bash
bash scripts/seed-data.sh
# → Inserts test users, games, availability, votes
```

### Testing

```bash
npm test             # vitest with @cloudflare/vitest-pool-workers
```

---

## 8. Discord Bot Contract

The Discord bot is **not implemented** in this repo. This section defines the API contract the bot must fulfill.

### Bot Responsibilities

1. **Auth**: When a user types `/play` in Discord, the bot:
   - Calls `POST /api/auth/token` with `{ discord_id, discord_username, avatar_url }`
   - DMs the user the auth URL: `https://<domain>/auth/<token>`

2. **Gather**: Periodically polls `GET /api/gather/pending`:
   - For each pending ping, sends a message to the Discord channel
   - Calls `PATCH /api/gather/:id/delivered` to mark as delivered

### Bot Auth (Deferred)

Bot-facing endpoints currently have no auth check. When the real bot is implemented, add an API key header (`X-Bot-Token`) validated against a Worker secret.

### Endpoints Used by Bot

- `POST /api/auth/token` — create auth link for a user
- `GET /api/gather/pending` — poll for gather bell pings
- `PATCH /api/gather/:id/delivered` — mark ping delivered

---

## 9. Key Technical Decisions

- **Time granularity**: 15-min default, admin-adjustable globally via settings, user-adjustable individually
- **Game pool lifespan**: 7 days; expired games auto-archived but remain visible with `?include_archived=true`
- **Session cleanup**: Lazy — expired tokens/sessions deleted on access. No cron trigger for MVP.
- **Cookie config**: `session_id=...; HttpOnly; SameSite=Lax; Path=/`. `Secure` flag only in production.
- **CORS**: Dev mode allows `localhost:5173` origin. Production serves SPA from same origin.
