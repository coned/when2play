# when2play Discord Bot — Setup Guide

This is the standalone Discord bot for [when2play](https://github.com/your-org/when2play). It provides:

- `/play` — generates a one-time login link and DMs it to the user
- `/when2play-admin` — generates a one-time admin link (requires Discord `ADMINISTRATOR` permission)
- `/help` — shows all available commands (ephemeral)
- `/url` — returns the when2play website URL
- **Core rally commands:**
  - `/call [message]` — call everyone to play
  - `/in [message]` — join the rally
  - `/out [reason]` — bail from the rally
  - `/ping @user [message]` — ping someone to come play
  - `/brb [message]` — be right back
  - `/where @user` — ask where someone is
- **Coordination commands:**
  - `/call2select @user` — nudge someone to set their availability on when2play
  - `/post schedule` — find and post the best overlapping time windows for today
  - `/post gamerank` — post the current game rankings to the channel
  - `/post gametree` — post today's gaming tree diagram to the channel
- **Admin commands:**
  - `/setchannel` — set the current channel as the bot output channel (requires ADMINISTRATOR)
- **Gather polling** — checks for pending gather bell pings every 15 seconds and posts them to a Discord channel
- **Rally polling** — checks for pending rally actions every 15 seconds and posts formatted messages
- **Tree share polling** — checks for pending gaming tree images and posts them as attachments

The bot connects to the when2play Cloudflare Worker backend via HTTP.

---

## Prerequisites

- Node.js 22+ (`node --version` to verify)
- A running when2play Worker deployment (see `docs/SETUP.md` in the main repo)
- A Discord bot application (see below)

---

## 1. Create a Discord Bot Application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application**, name it `when2play`
3. Go to **Bot** tab → **Reset Token** → copy the token
4. Under **Privileged Gateway Intents**, enable **Message Content Intent**
5. Go to **OAuth2** → **URL Generator**:
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `Send Messages`, `Use Slash Commands`
6. Open the generated URL and invite the bot to your server

---

## 2. Set the Output Channel

The bot needs to know which channel to post messages to. You have two options:

**Option A (recommended): `/setchannel` command**

After the bot is running, go to the desired channel in Discord and run `/setchannel`. This requires ADMINISTRATOR permission. The setting is saved to D1 via the API (`PATCH /api/settings/bot`) and persists across deploys and restarts.

**Option B: `GAMING_CHANNEL_ID` env var**

In Discord: **Settings** > **Advanced** > enable **Developer Mode**.
Then right-click the channel > **Copy Channel ID** and add it to your `.env` file.

If both are set, the `/setchannel` value takes priority.

---

## 3. Install Dependencies

```bash
npm install
```

---

## 4. Configure Environment Variables

Create a `.env` file in this directory:

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
| `BOT_API_KEY` | Yes (production) | Shared secret -- must match `BOT_API_KEY` set via `npx wrangler secret put BOT_API_KEY` in the main repo |
| `GAMING_CHANNEL_ID` | No | Fallback channel ID. Optional if using `/setchannel` instead |

> `BOT_API_KEY` can be omitted for local development against a Worker that also has no `BOT_API_KEY` set.

---

## 5. Run the Bot

```bash
node --env-file=.env bot.mjs
```

Expected output on success:

```
Logged in as when2play#1234
Slash commands registered (N guild(s): ...).
Loaded settings for N guild(s) from D1
Polling N guild(s) every 15s (with exponential backoff on errors)
```

---

## 6. Keeping It Running (Production)

The bot must stay running 24/7. Options:

### systemd (Linux VPS / home server)

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

### pm2

```bash
npm install -g pm2
pm2 start bot.mjs --name when2play-bot --env-file .env
pm2 save
pm2 startup   # follow the printed instructions to auto-start on reboot
```

### Cloud hosting

| Platform | Notes |
|----------|-------|
| Railway | `railway up` — free tier available |
| Fly.io | Dockerfile-based — free tier available |
| Render | Background worker type — free tier sleeps after inactivity |

---

## Troubleshooting

### `ConnectTimeoutError` when polling or handling `/play`

```
Error polling gather pings: TypeError: fetch failed
  [cause]: ConnectTimeoutError (attempted addresses: 172.67.x.x:443, timeout: 10000ms)
```

**This is a transient network issue on the bot's host**, not a bug. The bot's machine temporarily failed to reach the Cloudflare Worker IP. The bot recovers automatically on the next poll cycle (15 seconds). If it happens frequently, check:

- Whether the host's network has intermittent connectivity
- Whether a firewall is blocking outbound HTTPS
- Whether the `WHEN2PLAY_API_URL` is correct and the Worker is deployed

### `Missing required env vars` on startup

Either `DISCORD_TOKEN` or `WHEN2PLAY_API_URL` is missing from `.env`. Check that the file exists and is being loaded (`--env-file=.env`). Note: `GAMING_CHANNEL_ID` is no longer required -- you can use `/setchannel` instead.

### Slash commands not appearing in Discord

Commands are registered on bot startup via `registerCommands()`. This requires the bot to connect successfully at least once. If commands still don't appear after a minute, check the console for errors during startup.

### `Failed: ...` reply to `/play`

The Worker returned an error from `POST /api/auth/token`. Common causes:
- `BOT_API_KEY` in `.env` doesn't match the secret set in the Worker (`npx wrangler secret put BOT_API_KEY`)
- The Worker is not deployed or is unhealthy (`curl $WHEN2PLAY_API_URL/api/health`)

---

## Architecture

```
Discord Gateway (WebSocket)
        ↕
  bot.mjs (single instance, multi-guild)
        ↕  HTTPS + X-Bot-Token + X-Guild-Id headers
  when2play Cloudflare Worker
        ↕  guild middleware routes to per-guild DB
  Cloudflare D1 (one database per guild)
```

**Multi-guild support:** The bot sends `X-Guild-Id` with every API request. The Worker's guild middleware routes each request to the correct guild's D1 database. See `docs/MULTI_GUILD.md` for the full design.

**Polling loops** (per-guild, all run in parallel every 15s with per-guild exponential backoff):
1. Gather pings: `GET /api/gather/pending` -> format -> send -> `PATCH /api/gather/:id/delivered`
2. Rally actions: `GET /api/rally/pending` -> format by action_type -> send -> `PATCH /api/rally/:id/delivered`
3. Tree shares: `GET /api/rally/tree/share/pending` -> decode base64 -> send as attachment -> `PATCH /api/rally/tree/share/:id/delivered`

**Rally commands** authenticate users via the auth token flow (`POST /api/auth/token` -> `GET /api/auth/callback/:token`) to get a session, then call rally API endpoints on behalf of the user.

For an alternative architecture with no separate bot process, see `docs/CLOUDFLARE_NATIVE_BOT.md` in the main when2play repo.

---

## Multi-Guild Support

The bot supports multiple Discord guilds with a single instance. Each guild gets its own isolated D1 database on the Worker side. See `docs/MULTI_GUILD.md` for the full architecture design.

Channel configuration is stored in D1 via the `/api/settings/bot` endpoint. On startup, the bot fetches settings for each guild it has joined. Use `/setchannel` to configure the output channel for each guild.
