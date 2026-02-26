# when2play — Setup Guide

## Prerequisites

- Node.js 22+ (`nvm use 22`)
- npm 10+
- Wrangler CLI (included in devDependencies)
- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier works)

---

## Part 1: Local Development

### Install & Run

```bash
npm install
make migrate-local
make dev
```

This starts:
- Backend at `http://localhost:8787` (Wrangler + local D1)
- Frontend at `http://localhost:5173` (Vite, proxies `/api/*` to backend)

### Simulating Auth (No Discord Bot)

```bash
make simulate
# Prints: Open http://localhost:5173/auth/<token>
```

### Seeding Test Data

```bash
make seed
```

### Alternative: Local Node.js Server

Runs without Wrangler using better-sqlite3 in-memory:

```bash
make dev-local
```

### Running Tests

```bash
make test          # single run
make test-watch    # watch mode
```

Tests use an in-memory SQLite database and apply all migrations automatically. No Cloudflare account needed.

### Available Commands

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

---

## Part 2: Production Deployment

### First-Time Setup

#### 1. Authenticate with Cloudflare

```bash
npx wrangler login
npx wrangler whoami   # verify
```

#### 2. Create D1 Database

```bash
npx wrangler d1 create when2play-db
```

Copy the returned `database_id` into `wrangler.jsonc`:

```jsonc
"d1_databases": [
    {
        "binding": "DB",
        "database_name": "when2play-db",
        "database_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
        "migrations_dir": "migrations"
    }
]
```

#### 3. Apply Migrations

```bash
make migrate-remote
```

Verify tables exist:

```bash
npx wrangler d1 execute when2play-db --remote --command "SELECT name FROM sqlite_master WHERE type='table'"
```

#### 4. Set Bot API Key

This protects bot-facing endpoints from unauthorized access. **Required before going public.**

```bash
# Generate a key
openssl rand -hex 32

# Store as Cloudflare secret
npx wrangler secret put BOT_API_KEY
# Paste the key when prompted
```

Your Discord bot must send this key as `X-Bot-Token` header on all bot-facing requests. See [Bot Authentication](#bot-authentication) for details.

If `BOT_API_KEY` is not set, the bot auth middleware is skipped — fine for local dev, **not safe for production** since anyone can create login sessions for arbitrary users via `POST /api/auth/token`.

#### 5. Deploy

```bash
make deploy
```

Output shows your Worker URL:

```
Published when2play (x.xx sec)
  https://when2play.<your-subdomain>.workers.dev
```

#### 6. Verify

```bash
curl https://when2play.<your-subdomain>.workers.dev/api/health
# → {"ok":true,"data":{"status":"healthy","timestamp":"..."}}
```

Open the URL in a browser — you should see the login page.

### Subsequent Deploys

```bash
# If new migrations exist:
make migrate-remote

# Deploy:
make deploy
```

### Optional: Custom Domain

In the Cloudflare dashboard: **Workers & Pages** → your worker → **Settings** → **Domains & Routes**.

### Environment

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `DB` | D1 Binding | Yes | Configured in `wrangler.jsonc` |
| `BOT_API_KEY` | Secret | Recommended | Shared secret for bot auth. Set via `wrangler secret put`. When unset, bot auth is skipped. |

| Limit | Detail |
|-------|--------|
| Free tier | 100k requests/day, 10ms CPU per request, D1 5M rows read/day |
| D1 storage | 5GB free, 10GB on paid plan |
| Static assets | Served from Cloudflare's edge CDN |
| Logs | `make logs` for real-time streaming |

---

## Part 3: Discord Bot Setup

The Discord bot is a **separate service** not included in this repo. It calls 3 API endpoints on the Worker.

### Architecture

```
Discord ←→ Bot (your code, hosted anywhere) ←→ when2play API (Cloudflare Worker)
```

### Bot Responsibilities

1. **`/play` command** — creates a one-time auth link and DMs it to the user
2. **Gather polling** — periodically checks for gather pings and posts them in a Discord channel

### Bot Authentication

All bot-facing endpoints require the `X-Bot-Token` header matching the `BOT_API_KEY` secret:

```
X-Bot-Token: <your-bot-api-key>
```

Protected endpoints:
- `POST /api/auth/token` — create login tokens for Discord users
- `GET /api/gather/pending` — poll for undelivered gather pings
- `PATCH /api/gather/:id/delivered` — mark ping as delivered

### Create a Discord Application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application**, name it "when2play"
3. Go to **Bot** tab → **Reset Token** → copy the bot token
4. Enable **Message Content Intent** under Privileged Gateway Intents
5. Bot Permissions: `Send Messages`, `Use Slash Commands`

### Invite the Bot

Go to **OAuth2** → **URL Generator**:
- Scopes: `bot`, `applications.commands`
- Permissions: `Send Messages`, `Use Slash Commands`

Open the generated URL and select your server.

### Example Bot (discord.js)

```bash
mkdir when2play-bot && cd when2play-bot
npm init -y
npm install discord.js
```

Create `.env`:

```env
DISCORD_TOKEN=your-bot-token-here
WHEN2PLAY_API_URL=https://when2play.<your-subdomain>.workers.dev
BOT_API_KEY=your-generated-key-here
GAMING_CHANNEL_ID=123456789012345678
```

Create `bot.mjs`:

```js
import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from 'discord.js';

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const API_URL = process.env.WHEN2PLAY_API_URL;
const BOT_API_KEY = process.env.BOT_API_KEY;
const GAMING_CHANNEL_ID = process.env.GAMING_CHANNEL_ID;
const GATHER_POLL_INTERVAL_MS = 15_000;

if (!DISCORD_TOKEN || !API_URL || !GAMING_CHANNEL_ID) {
    console.error('Missing required env vars');
    process.exit(1);
}

const botHeaders = {
    'Content-Type': 'application/json',
    ...(BOT_API_KEY ? { 'X-Bot-Token': BOT_API_KEY } : {}),
};

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commands = [
    new SlashCommandBuilder().setName('play').setDescription('Get a login link for when2play'),
];

async function registerCommands() {
    const rest = new REST().setToken(DISCORD_TOKEN);
    await rest.put(Routes.applicationCommands(client.user.id), {
        body: commands.map(c => c.toJSON()),
    });
    console.log('Slash commands registered.');
}

// /play handler
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'play') return;
    await interaction.deferReply({ flags: 64 });

    try {
        const res = await fetch(`${API_URL}/api/auth/token`, {
            method: 'POST',
            headers: botHeaders,
            body: JSON.stringify({
                discord_id: interaction.user.id,
                discord_username: interaction.user.displayName,
                avatar_url: interaction.user.displayAvatarURL({ size: 128 }),
            }),
        });
        const json = await res.json();

        if (!json.ok) {
            await interaction.editReply(`Failed: ${json.error.message}`);
            return;
        }

        try {
            await interaction.user.send(`Click to open **when2play**: ${json.data.url}\n\nExpires in 10 minutes.`);
            await interaction.editReply('Check your DMs for the login link!');
        } catch {
            await interaction.editReply(`Login link (expires in 10 min):\n${json.data.url}`);
        }
    } catch (err) {
        console.error('Error handling /play:', err);
        await interaction.editReply('Something went wrong. Is the when2play server running?');
    }
});

// Gather ping polling
async function pollGatherPings() {
    try {
        const res = await fetch(`${API_URL}/api/gather/pending`, { headers: botHeaders });
        const json = await res.json();
        if (!json.ok || json.data.length === 0) return;

        const channel = await client.channels.fetch(GAMING_CHANNEL_ID);
        if (!channel?.isTextBased()) return;

        for (const ping of json.data) {
            const sender = ping.is_anonymous ? 'Someone' : `<@${ping.user_id}>`;
            const msg = ping.message || 'Ready to play!';
            let text = `🔔 **Gather bell!** ${sender}: ${msg}`;

            // If targeted, mention specific users
            if (ping.target_user_ids && ping.target_user_ids.length > 0) {
                // target_user_ids are internal UUIDs — bot would need to map these
                // to Discord IDs. For now, just note it's targeted.
                text += ` (targeted ping)`;
            }

            await channel.send(text);
            await fetch(`${API_URL}/api/gather/${ping.id}/delivered`, {
                method: 'PATCH',
                headers: botHeaders,
            });
        }
    } catch (err) {
        console.error('Error polling gather pings:', err);
    }
}

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}`);
    await registerCommands();
    setInterval(pollGatherPings, GATHER_POLL_INTERVAL_MS);
    console.log(`Polling for gather pings every ${GATHER_POLL_INTERVAL_MS / 1000}s`);
});

client.login(DISCORD_TOKEN);
```

Run: `node --env-file=.env bot.mjs`

### Hosting the Bot

The bot needs to run 24/7:

| Platform | Cost | Notes |
|----------|------|-------|
| Home server / VPS | Free–$5/mo | Use `pm2`, `systemd`, or Docker |
| Railway | Free tier | `railway up` |
| Fly.io | Free tier | Dockerfile-based |
| Render | Free tier (sleeps) | Background worker type |

---

## Part 4: Security Reference

### Bot Authentication

Bot-facing endpoints require `X-Bot-Token` header matching the `BOT_API_KEY` Cloudflare secret. When the secret is not set, the check is skipped (local dev mode).

### Admin Privileges

The first registered user (earliest `created_at`) is the admin. Only the admin can modify global settings via `PATCH /api/settings`.

### CORS

- **Production** (HTTPS): same-origin only
- **Development** (HTTP): allows `localhost:5173` and `localhost:8787`

### Cookie Security

Session cookies: `HttpOnly`, `SameSite=Strict`, `Path=/`, `Secure` (production only). Sessions expire after 7 days.

### Input Validation

| Field | Limit |
|-------|-------|
| `discord_id` | 1-30 chars (Zod validated) |
| `discord_username` | 1-50 chars (Zod validated) |
| `avatar_url` | max 500 chars |
| Game `name` | max 100 chars |
| Game `image_url` | max 500 chars |
| Gather `message` | max 500 chars |
| Shame `reason` | max 200 chars |
| Gather `target_user_ids` | max 20 users |

### Security Headers

All responses include:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`

### Error Redaction

In production (HTTPS), unhandled errors return generic "Internal server error". In development, the full error message is returned.

### Data Privacy

- `GET /api/games/:id/votes` strips `user_id` from the response
- `GET /api/availability` scopes `user_id` param to the authenticated user (no cross-user personal data access without a date filter)

---

## Part 5: Quick Reference

| What | Command |
|------|---------|
| Install | `npm install` |
| Dev server | `make dev` |
| Build frontend | `make build` |
| Run tests | `make test` |
| Deploy | `make deploy` |
| Apply remote migrations | `make migrate-remote` |
| Apply local migrations | `make migrate-local` |
| Set bot secret | `npx wrangler secret put BOT_API_KEY` |
| Stream logs | `make logs` |
| Simulate auth | `make simulate` |
| Seed data | `make seed` |
| Query remote D1 | `npx wrangler d1 execute when2play-db --remote --command "SELECT ..."` |
