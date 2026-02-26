# when2play — Developer Setup Guide

This guide walks through deploying the when2play backend to Cloudflare Workers and setting up a Discord bot to integrate with it.

---

## Part 1: Cloudflare Workers Deployment

### Prerequisites

- A [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier works)
- Node.js 20+ and npm
- `wrangler` CLI (already in devDependencies)

### Step 1: Authenticate with Cloudflare

```bash
npx wrangler login
```

This opens a browser window. Log in and authorize Wrangler.

Verify:

```bash
npx wrangler whoami
```

### Step 2: Create a D1 Database

```bash
npx wrangler d1 create when2play-db
```

This outputs something like:

```
Created D1 database 'when2play-db'
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

**Copy the `database_id` value.**

### Step 3: Update wrangler.jsonc

Open `wrangler.jsonc` and replace `"database_id": "local"` with your real database ID:

```jsonc
"d1_databases": [
    {
        "binding": "DB",
        "database_name": "when2play-db",
        "database_id": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",  // ← paste here
        "migrations_dir": "migrations"
    }
]
```

### Step 4: Apply Database Migrations

```bash
npx wrangler d1 migrations apply when2play-db --remote
```

This runs all SQL files in `migrations/` against your remote D1 database.

Verify:

```bash
npx wrangler d1 execute when2play-db --remote --command "SELECT name FROM sqlite_master WHERE type='table'"
```

You should see all 9 tables (users, auth_tokens, sessions, games, game_votes, availability, gather_pings, shame_votes, settings).

### Step 5: Build the Frontend

```bash
npm run build
```

This builds the Preact SPA into `frontend/dist/`, which Wrangler serves as static assets.

### Step 6: Deploy

```bash
npx wrangler deploy
```

Output will show your Worker URL:

```
Published when2play (x.xx sec)
  https://when2play.<your-subdomain>.workers.dev
```

**This is your `WORKER_URL`.** Save it — the Discord bot needs it.

### Step 7: Verify Deployment

```bash
curl https://when2play.<your-subdomain>.workers.dev/api/health
```

Expected: `{"ok":true,"data":{"status":"healthy","timestamp":"..."}}`

Open the URL in a browser — you should see the when2play landing page.

### Optional: Custom Domain

In the Cloudflare dashboard:
1. Go to **Workers & Pages** → your worker → **Settings** → **Domains & Routes**
2. Add a custom domain (your domain must be on Cloudflare DNS)

### Environment Notes

| Item | Detail |
|------|--------|
| Free tier limits | 100k requests/day, 10ms CPU per request, D1 5M rows read/day |
| D1 storage | 5GB free, 10GB on paid plan |
| Static assets | Served from Cloudflare's edge CDN automatically |
| Logs | `npx wrangler tail` for real-time logs |

---

## Part 2: Discord Bot Setup

### What the Bot Does

The Discord bot is a **separate service** — it is **not included in this repo**. You must build and host it yourself.

The bot's responsibilities:
1. **`/play` command** — creates a one-time auth link and DMs it to the user
2. **Gather polling** — periodically checks for gather bell pings and posts them in a Discord channel

### Architecture

```
Discord ←→ Bot (your code, hosted anywhere) ←→ when2play API (Cloudflare Worker)
```

The bot calls 3 API endpoints on the Worker:
- `POST /api/auth/token` — create auth link
- `GET /api/gather/pending` — poll for gather pings
- `PATCH /api/gather/:id/delivered` — mark ping delivered

### Step 1: Create a Discord Application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application**, name it "when2play"
3. Go to the **Bot** tab
4. Click **Reset Token** and **copy the bot token** — you'll need it later
5. Under **Privileged Gateway Intents**, enable:
   - **Message Content Intent** (if your bot reads messages)
6. Under **Bot Permissions**, the bot needs:
   - `Send Messages`
   - `Send Messages in Threads` (optional)
   - `Use Slash Commands`

### Step 2: Invite the Bot to Your Server

Go to **OAuth2** → **URL Generator**:
- Scopes: `bot`, `applications.commands`
- Permissions: `Send Messages`, `Use Slash Commands`

Copy the generated URL, open it in a browser, and select your server.

### Step 3: Build the Bot

The bot can be written in any language. Below is a **complete working example** using **discord.js** (Node.js).

#### Project Setup

```bash
mkdir when2play-bot
cd when2play-bot
npm init -y
npm install discord.js
```

#### Create `.env`

```env
DISCORD_TOKEN=your-bot-token-here
WHEN2PLAY_API_URL=https://when2play.<your-subdomain>.workers.dev
GAMING_CHANNEL_ID=123456789012345678
```

Replace:
- `DISCORD_TOKEN` — the bot token from Step 1
- `WHEN2PLAY_API_URL` — your deployed Worker URL from Part 1, Step 6
- `GAMING_CHANNEL_ID` — right-click a Discord channel → Copy Channel ID (enable Developer Mode in Discord settings)

#### Create `bot.mjs`

```js
import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from 'discord.js';

// --- Configuration ---

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const API_URL = process.env.WHEN2PLAY_API_URL;
const GAMING_CHANNEL_ID = process.env.GAMING_CHANNEL_ID;
const GATHER_POLL_INTERVAL_MS = 15_000; // 15 seconds

if (!DISCORD_TOKEN || !API_URL || !GAMING_CHANNEL_ID) {
    console.error('Missing required environment variables: DISCORD_TOKEN, WHEN2PLAY_API_URL, GAMING_CHANNEL_ID');
    process.exit(1);
}

// --- Discord Client ---

const client = new Client({
    intents: [GatewayIntentBits.Guilds],
});

// --- Register Slash Command ---

const commands = [
    new SlashCommandBuilder()
        .setName('play')
        .setDescription('Get a login link for when2play'),
];

async function registerCommands() {
    const rest = new REST().setToken(DISCORD_TOKEN);
    console.log('Registering slash commands...');
    await rest.put(Routes.applicationCommands(client.user.id), {
        body: commands.map(c => c.toJSON()),
    });
    console.log('Slash commands registered.');
}

// --- /play Command Handler ---

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== 'play') return;

    await interaction.deferReply({ flags: 64 }); // ephemeral

    try {
        const res = await fetch(`${API_URL}/api/auth/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                discord_id: interaction.user.id,
                discord_username: interaction.user.displayName,
                avatar_url: interaction.user.displayAvatarURL({ size: 128 }),
            }),
        });

        const json = await res.json();

        if (!json.ok) {
            await interaction.editReply(`Failed to create login link: ${json.error.message}`);
            return;
        }

        // The URL from the API points to the Worker domain.
        // Send it as a DM and also reply in-channel.
        const url = json.data.url;

        try {
            await interaction.user.send(
                `Click here to open **when2play**: ${url}\n\nThis link expires in 10 minutes.`
            );
            await interaction.editReply('Check your DMs for the login link!');
        } catch {
            // DMs might be disabled — fall back to ephemeral reply
            await interaction.editReply(
                `Here's your login link (expires in 10 min):\n${url}`
            );
        }
    } catch (err) {
        console.error('Error handling /play:', err);
        await interaction.editReply('Something went wrong. Is the when2play server running?');
    }
});

// --- Gather Ping Polling ---

// Maps discord_id → discord user ID for resolving pings.
// Populated when /play is used; in a real setup you'd query the API or cache.
const discordIdCache = new Map();

async function pollGatherPings() {
    try {
        const res = await fetch(`${API_URL}/api/gather/pending`);
        const json = await res.json();

        if (!json.ok || json.data.length === 0) return;

        const channel = await client.channels.fetch(GAMING_CHANNEL_ID);
        if (!channel?.isTextBased()) return;

        for (const ping of json.data) {
            const message = ping.message || 'Ready to play!';
            await channel.send(`🔔 **Gather bell!** ${message}`);

            // Mark as delivered
            await fetch(`${API_URL}/api/gather/${ping.id}/delivered`, {
                method: 'PATCH',
            });
        }
    } catch (err) {
        console.error('Error polling gather pings:', err);
    }
}

// --- Startup ---

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}`);
    await registerCommands();

    // Start gather polling loop
    setInterval(pollGatherPings, GATHER_POLL_INTERVAL_MS);
    console.log(`Polling for gather pings every ${GATHER_POLL_INTERVAL_MS / 1000}s`);
});

client.login(DISCORD_TOKEN);
```

#### Run the Bot

```bash
node --env-file=.env bot.mjs
```

You should see:

```
Logged in as when2play#1234
Registering slash commands...
Slash commands registered.
Polling for gather pings every 15s
```

### Step 4: Test the Integration

1. In Discord, type `/play`
2. The bot DMs you a login link
3. Click the link → browser opens → you're logged in to when2play
4. In the dashboard, ring the **Gather Bell**
5. Within 15 seconds, the bot posts a message in your gaming channel

### Step 5: Host the Bot

The bot needs to run 24/7. Options:

| Platform | Cost | Notes |
|----------|------|-------|
| **Home server / VPS** | Free–$5/mo | Run with `pm2`, `systemd`, or Docker |
| **Railway** | Free tier available | `railway up` |
| **Fly.io** | Free tier available | Dockerfile-based |
| **Render** | Free tier (sleeps) | Background worker type |
| **AWS EC2 / Lightsail** | $3.50+/mo | Full control |

Example with `pm2`:

```bash
npm install -g pm2
pm2 start bot.mjs --name when2play-bot
pm2 save
pm2 startup   # auto-start on reboot
```

---

## Part 3: Security Hardening (Before Going Public)

The bot-facing API endpoints currently have **no authentication**. Before exposing to the internet:

### Add Bot API Key

1. Generate a secret key:

   ```bash
   openssl rand -hex 32
   ```

2. Add it as a Cloudflare Worker secret:

   ```bash
   npx wrangler secret put BOT_API_KEY
   # Paste the key when prompted
   ```

3. Add the same key to the bot's `.env`:

   ```env
   BOT_API_KEY=your-generated-key-here
   ```

4. Update the bot to send the key on every request:

   ```js
   const headers = {
       'Content-Type': 'application/json',
       'X-Bot-Token': process.env.BOT_API_KEY,
   };
   ```

5. Add middleware to the Worker to validate bot-facing endpoints. In `src/middleware/bot-auth.ts`:

   ```ts
   import { createMiddleware } from 'hono/factory';

   export const requireBotAuth = createMiddleware(async (c, next) => {
       const token = c.req.header('X-Bot-Token');
       const expected = c.env.BOT_API_KEY;
       if (!expected || token !== expected) {
           return c.json({ ok: false, error: { code: 'UNAUTHORIZED', message: 'Invalid bot token' } }, 401);
       }
       await next();
   });
   ```

6. Apply to bot-facing routes (`POST /api/auth/token`, `GET /api/gather/pending`, `PATCH /api/gather/:id/delivered`).

### Update Env Bindings

Add `BOT_API_KEY` to `src/env.ts`:

```ts
export interface Bindings {
    DB: D1Database;
    BOT_API_KEY: string;
}
```

---

## Quick Reference

| What | Command |
|------|---------|
| Deploy Worker | `npx wrangler deploy` |
| View logs | `npx wrangler tail` |
| Apply migrations (remote) | `npx wrangler d1 migrations apply when2play-db --remote` |
| Apply migrations (local) | `npx wrangler d1 migrations apply when2play-db --local` |
| Build frontend | `npm run build` |
| Run tests | `npm test` |
| Run local dev server | `npx tsx scripts/serve-local.ts` |
| Create test auth token | `bash scripts/simulate-bot.sh` |
| Query remote D1 | `npx wrangler d1 execute when2play-db --remote --command "SELECT ..."` |
