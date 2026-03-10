# Local Development

## Prerequisites

- Node.js 22+ (`nvm use 22`)
- npm 10+
- Wrangler CLI (included in devDependencies)

A Cloudflare account is **not** needed for local development.

---

## Install & Run

```bash
npm install
make migrate-local
make dev
```

This starts:
- Backend at `http://localhost:8787` (Wrangler + local D1)
- Frontend at `http://localhost:5173` (Vite, proxies `/api/*` to backend)

---

## Simulating Auth (No Discord Bot)

You can log in without a Discord bot by generating a test auth token:

```bash
make simulate
# Prints: Open http://localhost:5173/auth/<token>
```

Open the printed URL in your browser to land on the dashboard.

---

## Seeding Test Data

```bash
make seed
```

Populates the local D1 database with sample users, games, votes, and availability.

---

## Alternative: Local Node.js Server

Runs the backend without Wrangler, using better-sqlite3 in-memory:

```bash
make dev-local
```

Useful when you want a faster restart cycle or don't need Wrangler-specific features.

---

## Running Tests

```bash
make test          # single run
make test-watch    # watch mode
```

Tests use an in-memory SQLite database and apply all migrations automatically. No Cloudflare account needed.

---

## Available Commands

Run `make help` to see all targets:

| Command | Description |
|---------|-------------|
| `make dev` | Run wrangler + vite concurrently |
| `make dev-local` | Run local Node.js server |
| `make build` | Build frontend |
| `make test` | Run all tests |
| `make test-watch` | Run tests in watch mode |
| `make deploy` | Build and deploy to Cloudflare |
| `make deploy-only` | Deploy without rebuilding |
| `make migrate-local` | Apply migrations locally |
| `make migrate-remote` | Apply migrations remotely |
| `make seed` | Seed test data |
| `make simulate` | Create test auth token |
| `make logs` | Stream live logs |
| `make clean` | Clean build artifacts |
