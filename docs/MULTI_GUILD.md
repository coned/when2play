# Multi-Guild Architecture Design

> Status: Design only -- not yet implemented.

This document describes how to evolve the when2play Discord bot from single-guild to multi-guild support. It builds on Phase 1's dynamic channel selection (`/setchannel` + `guild-config.json`).

---

## Why Not Multi-Tenant Single-DB?

The obvious approach -- one backend, one database, add a `guild_id` column everywhere -- has significant downsides for this app:

- **Schema invasiveness.** Nearly every table (users, rallies, actions, gather pings, games, votes, schedules) would need a `guild_id` column, composite indexes, and scoped queries. This is a large, error-prone migration.
- **Data isolation risk.** A single bug in guild scoping can leak one group's data to another. For a social app where "who bailed" and "who's available" is visible, this is a real concern.
- **Deployment coupling.** All guilds share the same Worker, D1 database, and rate limits. One guild's heavy usage affects everyone.
- **Complexity vs. benefit.** when2play is designed for small friend groups (5-20 people). The operational overhead of multi-tenancy outweighs the marginal cost of separate deployments.

Separate deployments give clean isolation with zero backend schema changes.

---

## Recommended Approach: Bot-Side Routing + Separate Backends

Each guild gets its own Cloudflare Worker + D1 deployment. One bot instance serves all guilds by maintaining a local config mapping.

### Architecture

```
Discord Gateway (WebSocket)
        |
   bot.mjs (single instance, multi-guild aware)
        |
        +-- Guild A config --> Worker A + D1 A
        +-- Guild B config --> Worker B + D1 B
        +-- Guild C config --> Worker C + D1 C
```

---

## Config File Schema

Phase 1 uses a flat structure:

```json
{ "channelId": "123456789" }
```

Phase 2 evolves this to per-guild mappings:

```json
{
  "guilds": {
    "111111111111111111": {
      "apiUrl": "https://when2play-guild-a.workers.dev",
      "botApiKey": "secret-a",
      "channelId": "222222222222222222"
    },
    "333333333333333333": {
      "apiUrl": "https://when2play-guild-b.workers.dev",
      "botApiKey": "secret-b",
      "channelId": "444444444444444444"
    }
  }
}
```

### Migration from Phase 1

When the bot starts and finds the old flat format, it migrates automatically:

1. Read the flat `{ channelId }` config
2. Use the env vars `WHEN2PLAY_API_URL` and `BOT_API_KEY` as defaults
3. On first interaction from a guild, create the guild entry with these defaults + the existing channel ID
4. Write the new format and proceed

This is a one-time, non-destructive migration. The old env vars remain as fallbacks for guilds that haven't been explicitly configured.

---

## `/setup` Admin Command

A new `/setup` command (ADMINISTRATOR only) registers a guild:

```
/setup api_url:https://when2play-myguild.workers.dev api_key:my-secret
```

This writes the guild entry to `guild-config.json` with the `interaction.guildId` as key and `interaction.channelId` as the default channel. It validates the backend is reachable (`GET /api/health`) before saving.

`/setchannel` continues to work as before, updating the `channelId` for the current guild.

---

## Slash Command Routing

All command handlers change from using global env vars to looking up the guild config:

```js
// Before (Phase 1)
const res = await fetch(`${API_URL}/api/auth/token`, { headers: botHeaders, ... });

// After (Phase 2)
const guildConfig = getGuildConfig(interaction.guildId);
if (!guildConfig) {
    await interaction.editReply('This server is not set up. An admin should run `/setup` first.');
    return;
}
const res = await fetch(`${guildConfig.apiUrl}/api/auth/token`, {
    headers: buildHeaders(guildConfig),
    ...
});
```

A `getGuildConfig(guildId)` helper returns the config object or `null`. A `buildHeaders(guildConfig)` helper constructs the `Content-Type` + `X-Bot-Token` headers using the guild-specific API key.

---

## Polling Loop Changes

The current polling loop runs three functions in parallel for a single backend. In Phase 2, it iterates over all registered guilds:

```js
async function pollAll() {
    const guilds = Object.entries(cachedConfig.guilds || {});
    await Promise.all(guilds.map(async ([guildId, config]) => {
        await Promise.all([
            pollGatherPings(config),
            pollRallyActions(config),
            pollTreeShares(config),
        ]);
    }));
}
```

Each poll function takes a guild config and uses `config.apiUrl`, `config.botApiKey`, and `config.channelId` instead of global constants. Error tracking (consecutive errors, backoff) becomes per-guild to prevent one broken deployment from affecting others.

---

## Deployment Model

Each guild needs a Worker + D1 instance. Provisioning can be scripted:

```bash
# provision-guild.sh <guild-name>
GUILD_NAME=$1
wrangler d1 create "when2play-${GUILD_NAME}"
# Update wrangler.toml with the new D1 binding
wrangler deploy --name "when2play-${GUILD_NAME}"
wrangler secret put BOT_API_KEY --name "when2play-${GUILD_NAME}"
```

The bot admin runs `/setup` with the resulting Worker URL and API key.

Cloudflare Workers free tier allows up to 100,000 requests/day per account, and D1 free tier allows 5M rows read and 100K rows written per day. For small friend groups, a single Cloudflare account can host many guild deployments.

---

## Edge Cases

### Guild removal

When the bot is removed from a guild (or an admin wants to disconnect):

- `/teardown` command removes the guild entry from config
- Polling loop skips guilds without config entries
- The backend deployment remains intact (data is not deleted)

### Backend URL changes

An admin re-runs `/setup` with the new URL. The old URL is simply overwritten. In-flight poll requests to the old URL will fail once and succeed on the next cycle with the new URL.

### API key rotation

1. Set the new key in the Worker: `wrangler secret put BOT_API_KEY`
2. Run `/setup` again with the new key (or a dedicated `/rotate-key` command)
3. The bot immediately uses the new key for all subsequent requests

### Bot restarts

Config is persisted to disk. On restart, the bot loads `guild-config.json` and resumes polling for all guilds.

### Race conditions

Multiple admins running `/setup` simultaneously could cause write conflicts on the JSON file. Use a simple write lock (in-memory mutex) around `saveConfig()` to prevent corruption. This is sufficient since the bot runs as a single process.

---

## Auth Flow Changes

Currently, `ensureUser()` and `apiCallWithSession()` use global `API_URL` and `botHeaders`. In Phase 2:

- `ensureUser(discordUser, guildMember, guildConfig)` takes a guild config parameter
- `apiCallWithSession(sessionId, path, options, guildConfig)` routes to the correct backend
- Sessions are backend-scoped (a session from Guild A's backend is not valid for Guild B's backend), which is the correct behavior since users may have different data in each guild

---

## Summary of Changes (Phase 2 Implementation Scope)

| Area | Change |
|------|--------|
| Config schema | Flat object to per-guild nested object |
| `/setup` command | New ADMINISTRATOR command to register a guild |
| `/setchannel` | Updated to write under the guild key |
| All command handlers | Lookup guild config from `interaction.guildId` |
| `ensureUser()` | Accept guild config parameter |
| `apiCallWithSession()` | Accept guild config parameter |
| Polling loop | Iterate over all registered guilds |
| Error tracking | Per-guild consecutive error counters |
| Provisioning | Script to create Worker + D1 per guild |
