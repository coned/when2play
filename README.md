# when2play Discord Bot Module

A Discord bot for coordinating gaming sessions with your friends. Rally people to play, schedule availability, vote on games, and more — all from Discord slash commands.

## Quick Start

### 1. Install Node.js (v22 LTS; at least 20.6)

If you don't have Node.js installed, grab it from [nodejs.org](https://nodejs.org/) (use the LTS installer).

**Linux servers** — install via NodeSource apt repo:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
```

Or use [nvm](https://github.com/nvm-sh/nvm):

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 22
```

Verify with:

```bash
node --version   # should print v22.x.x or higher
```

### 2. Install dependencies

```bash
npm install
```

### 3. Create a Discord bot & get your token

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **New Application** → name it `when2play`
3. Go to **Bot** tab → **Reset Token** → copy the token
4. Under **Privileged Gateway Intents**, enable **Message Content Intent**
5. Go to **OAuth2 → URL Generator** — select scopes `bot` + `applications.commands`, and permissions `Send Messages` + `Use Slash Commands`
6. Open the generated URL to invite the bot to your server

### 4. Configure environment

Copy the example below into a `.env` file in this directory:

```env
DISCORD_TOKEN=your-bot-token-here
WHEN2PLAY_API_URL=https://when2play.<your-subdomain>.workers.dev
BOT_API_KEY=your-shared-secret-here
GAMING_CHANNEL_ID=123456789012345678   # optional if using /setchannel
POLL_INTERVAL_MS=15000                 # optional, delivery poll interval (min 5000)
```

> **Channel setup:** You can either set `GAMING_CHANNEL_ID` in `.env`, or use the `/setchannel` slash command in Discord (requires ADMINISTRATOR). The slash command is preferred -- it is stored in the Worker's D1 database and takes priority over the env var.

### 5. Run locally

```bash
make run    # node --env-file=.env bot.mjs, in the foreground (development only)
```

You should see something similar to:

```
Logged in as when2play#1234
Slash commands registered (1 guild(s): ...).
```

The bot needs a Worker that has `POST /api/users/sync` (rally commands act as the Discord
user with `X-Discord-User-Id` instead of creating sessions).

### 6. Production

Production runs as the user-level systemd service `deploy/when2play-bot.service` on the bot
host, managed from this repo with `make`:

```bash
make install-service   # one time: install, enable and linger the unit on the host
make deploy            # npm test, rsync to the host, restart the service
make logs              # last 50 journal lines
```

Deploy order when the Worker changes too: Worker migrations, then the Worker, then the bot.
A restart is graceful: on SIGTERM the bot sends the acks of items it already posted before
exiting, so nothing is posted twice. Details in [docs/SETUP.md](docs/SETUP.md).

### Tests

```bash
npm test    # or: make test
```

Unit tests (`node:test`, no network) for the delivery poller, the shutdown ack flush, API
error handling, the message formatters and the settings retry.

## Commands at a Glance

| Command | What it does |
|---------|-------------|
| `/help` | List all commands |
| `/when2play` | Get a login link for the when2play dashboard |
| `/call` | Rally everyone to play |
| `/in` / `/out` | Join or leave the rally |
| `/ping @user` | Ping someone to come play |
| `/post schedule` | Show overlapping availability windows |
| `/post gamerank` | Post game rankings |
| `/post gametree` | Post the gaming tree diagram |
| `/setchannel` | Set the current channel as the bot output channel (admin) |

## Further Reading

- **[docs/SETUP.md](docs/SETUP.md)** -- full setup guide, production deployment (systemd user service, Makefile targets, deploy order), and troubleshooting
- **[docs/DATAFLOW.md](docs/DATAFLOW.md)** -- technical architecture, API endpoints, act-as authentication, polling internals and graceful shutdown
