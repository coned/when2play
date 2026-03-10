# First-Time Deployment

This guide covers everything needed to go from zero to a running when2play instance: Cloudflare Worker backend, and Discord bot.

---

## Part 1: Cloudflare Worker (Backend + Frontend)

### 1. Authenticate with Cloudflare

Create a free [Cloudflare account](https://dash.cloudflare.com/sign-up) if you don't have one.

```bash
npx wrangler login
npx wrangler whoami   # verify
```

### 2. Create a D1 Database

Each Discord guild (server) gets its own D1 database. Start with one.

First, copy the template config (this file is gitignored because it contains guild-specific IDs; your copy stays local):

```bash
cp wrangler.jsonc.template wrangler.jsonc
```

Then create the database:

```bash
npx wrangler d1 create when2play-<guild-name>
```

Wrangler auto-adds an entry to the `d1_databases` array in `wrangler.jsonc`, but **the binding name and migrations_dir need manual fixes**:

- Change `binding` from `"when2play_<name>"` to `"DB_<guild_id>"` (the Worker looks up databases by guild snowflake at runtime).
- Add `"migrations_dir": "migrations"` (required for `wrangler d1 migrations apply`).
- `database_name` and `database_id` are fine as-is.

The corrected entry should look like:

```jsonc
"d1_databases": [
    {
        "binding": "DB_<guild_id>",
        "database_name": "when2play-<guild-name>",
        "database_id": "<auto-filled by wrangler>",
        "migrations_dir": "migrations"
    }
]
```

Replace `<guild_id>` with the Discord server's snowflake ID (17-20 digit number). To find it: enable Developer Mode in Discord settings, then right-click the server name and **Copy Server ID**.

### 3. Apply Migrations

```bash
make migrate-remote
```

Verify tables exist:

```bash
npx wrangler d1 execute when2play-<guild-name> --remote --command "SELECT name FROM sqlite_master WHERE type='table'"
```

### 4. Set the Bot API Key

This protects bot-facing endpoints from unauthorized access. **Required before going public.**

```bash
# Generate a key
openssl rand -hex 32

# Store as Cloudflare secret
npx wrangler secret put BOT_API_KEY
# Paste the key when prompted
```

Save this key somewhere safe; you will also need it for the Discord bot's `.env` file.

If `BOT_API_KEY` is not set, bot auth is skipped. Fine for local dev, **not safe for production** since anyone could create login sessions for arbitrary users via `POST /api/auth/token`.

### 5. Deploy

```bash
make deploy
```

Output shows your Worker URL:

```
Published when2play (x.xx sec)
  https://when2play.<your-subdomain>.workers.dev
```

### 6. Verify

```bash
curl https://when2play.<your-subdomain>.workers.dev/api/health
# {"ok":true,"data":{"status":"healthy","timestamp":"..."}}
```

Open the URL in a browser to see the login page.

### Environment Reference

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `DB_<guild_id>` | D1 Binding | Yes (1+) | Per-guild D1 database. Named `DB_` + Discord guild snowflake. |
| `BOT_API_KEY` | Secret | Recommended | Shared secret for bot auth. Set via `wrangler secret put`. |
| `VERBOSE_ERRORS` | Secret/Var | No | Set to `1` for full error messages in 500 responses. |

### Cloudflare Free Tier Limits

| Limit | Detail |
|-------|--------|
| Requests | 100k requests/day |
| CPU | 10ms CPU per request |
| D1 reads | 5M rows read/day |
| D1 storage | 5GB free, 10GB on paid plan |
| Static assets | Served from Cloudflare's edge CDN |

### Optional: Custom Domain

In the Cloudflare dashboard: **Workers & Pages** > your worker > **Settings** > **Domains & Routes**.

---

## Part 2: Discord Bot

The Discord bot is a **separate service** that runs alongside the Worker. It provides slash commands and delivers notifications to Discord channels.

### 1. Create a Discord Bot Application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application**, name it `when2play`
3. Go to **Bot** tab > **Reset Token** > copy the bot token
4. Under **Privileged Gateway Intents**, enable **Message Content Intent**
5. Go to **OAuth2** > **URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `Send Messages`, `Use Slash Commands`
6. Open the generated URL to invite the bot to your Discord server

### 2. Install the Bot

The bot lives in a separate repository (`when2play_discordbot/`).

```bash
cd when2play_discordbot
npm install
```

### 3. Configure Environment

Create a `.env` file in the bot directory:

```env
DISCORD_TOKEN=your-bot-token-here
WHEN2PLAY_API_URL=https://when2play.<your-subdomain>.workers.dev
BOT_API_KEY=your-generated-key-here
GAMING_CHANNEL_ID=123456789012345678
```

| Variable | Required | Description |
|----------|----------|-------------|
| `DISCORD_TOKEN` | Yes | Bot token from Discord Developer Portal |
| `WHEN2PLAY_API_URL` | Yes | Base URL of the deployed when2play Worker |
| `BOT_API_KEY` | Yes (production) | Must match the `BOT_API_KEY` set via `wrangler secret put` on the Worker |
| `GAMING_CHANNEL_ID` | No | Fallback channel ID. Optional if using `/setchannel` instead |

> **Channel setup:** You can either set `GAMING_CHANNEL_ID` in `.env`, or use the `/setchannel` slash command in Discord (requires ADMINISTRATOR). The slash command persists the setting in D1 and takes priority over the env var.

### 4. Run the Bot

```bash
node --env-file=.env bot.mjs
```

Expected output:

```
Logged in as when2play#1234
Slash commands registered (N guild(s): ...).
Loaded settings for N guild(s) from D1
Polling N guild(s) every 15s (with exponential backoff on errors)
```

Slash commands like `/call`, `/in`, `/when2play`, and `/help` are now live.

### 5. Set the Output Channel

After the bot is running, go to the desired channel in Discord and run `/setchannel` (requires ADMINISTRATOR permission). This persists the channel ID in D1 and takes priority over the `GAMING_CHANNEL_ID` env var.

### 6. Keeping the Bot Running (Production)

The bot must stay running 24/7.

**systemd (Linux VPS / home server):**

Create `/etc/systemd/system/when2play-bot.service`:

```ini
[Unit]
Description=when2play Discord Bot
After=network.target

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/when2play_discordbot
ExecStart=/usr/bin/node --env-file=.env bot.mjs
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Then:

```bash
sudo systemctl daemon-reload
sudo systemctl enable when2play-bot
sudo systemctl start when2play-bot
sudo systemctl status when2play-bot
```

**pm2:**

```bash
npm install -g pm2
pm2 start bot.mjs --name when2play-bot --env-file .env
pm2 save
pm2 startup   # follow the printed instructions to auto-start on reboot
```

**Cloud hosting:**

| Platform | Notes |
|----------|-------|
| Railway | `railway up` - free tier available |
| Fly.io | Dockerfile-based - free tier available |
| Render | Background worker type - free tier sleeps after inactivity |

---

## Verification Checklist

After completing both parts:

1. Open the Worker URL in a browser - you should see the login page
2. In Discord, run `/when2play` - the bot should DM you a login link
3. Click the login link - the dashboard should load
4. Run `/setchannel` in the desired Discord channel
5. Try `/call` - a rally notification should appear in the channel
