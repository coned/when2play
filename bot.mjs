import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, AttachmentBuilder } from 'discord.js';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ERROR_LOG_PATH = join(__dirname, 'errors.log');
const CONFIG_PATH = join(__dirname, 'guild-config.json');

let cachedConfig = {};

function loadConfig() {
    try {
        cachedConfig = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
    } catch {
        cachedConfig = {};
    }
    return cachedConfig;
}

function saveConfig(data) {
    cachedConfig = data;
    writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2) + '\n');
}

function getChannelId() {
    return cachedConfig.channelId || GAMING_CHANNEL_ID || null;
}

function logError(context, err) {
    const ts = new Date().toISOString();
    const cause = err.cause ? ` | cause: ${err.cause.message ?? err.cause}` : '';
    const line = `[${ts}] ${context}: ${err.message}${cause}\n`;
    try { appendFileSync(ERROR_LOG_PATH, line); } catch {}
}

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const API_URL = process.env.WHEN2PLAY_API_URL;
const BOT_API_KEY = process.env.BOT_API_KEY;
const GAMING_CHANNEL_ID = process.env.GAMING_CHANNEL_ID;
const GUILD_ID = process.env.GUILD_ID;
const BASE_POLL_MS = 15_000;
const MAX_POLL_MS = 2 * 60 * 1000;
let consecutiveErrors = 0;

loadConfig();

if (!DISCORD_TOKEN || !API_URL) {
    console.error('Missing required env vars (DISCORD_TOKEN, WHEN2PLAY_API_URL)');
    process.exit(1);
}
if (!getChannelId()) {
    console.warn('Warning: No channel configured. Use /setchannel or set GAMING_CHANNEL_ID in .env');
}

const botHeaders = {
    'Content-Type': 'application/json',
    ...(BOT_API_KEY ? { 'X-Bot-Token': BOT_API_KEY } : {}),
};

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commands = [
    new SlashCommandBuilder().setName('play').setDescription('Get a login link for when2play'),
    new SlashCommandBuilder()
        .setName('when2play-admin')
        .setDescription('Get a one-time admin link for when2play (requires ADMINISTRATOR)'),
    new SlashCommandBuilder()
        .setName('call')
        .setDescription('Call everyone to play!')
        .addStringOption(o => o.setName('message').setDescription('Optional message').setRequired(false)),
    new SlashCommandBuilder()
        .setName('in')
        .setDescription("I'm in! Join the rally")
        .addStringOption(o => o.setName('message').setDescription('Optional message').setRequired(false)),
    new SlashCommandBuilder()
        .setName('out')
        .setDescription("I'm out / bail from rally")
        .addStringOption(o => o.setName('reason').setDescription('Why?').setRequired(false)),
    new SlashCommandBuilder()
        .setName('ping')
        .setDescription('Ping someone to come play')
        .addUserOption(o => o.setName('user').setDescription('Who to ping').setRequired(true))
        .addStringOption(o => o.setName('message').setDescription('Optional message').setRequired(false)),
    new SlashCommandBuilder()
        .setName('brb')
        .setDescription('Be right back, joining shortly')
        .addStringOption(o => o.setName('message').setDescription('Optional message').setRequired(false)),
    new SlashCommandBuilder()
        .setName('where')
        .setDescription("Where are you? You didn't show up!")
        .addUserOption(o => o.setName('user').setDescription('Who to ask').setRequired(true)),
    new SlashCommandBuilder()
        .setName('call2select')
        .setDescription('Nudge someone to set their availability on when2play')
        .addUserOption(o => o.setName('user').setDescription('Who to nudge').setRequired(true)),
    new SlashCommandBuilder()
        .setName('post')
        .setDescription('Post information to the channel')
        .addSubcommand(sub => sub.setName('schedule').setDescription('Find and post the best overlapping time windows for today'))
        .addSubcommand(sub => sub.setName('gamerank').setDescription('Post the current game rankings to the channel'))
        .addSubcommand(sub => sub.setName('gametree').setDescription("Post today's gaming tree diagram to the channel")),
    new SlashCommandBuilder()
        .setName('url')
        .setDescription('Get the when2play website URL'),
    new SlashCommandBuilder()
        .setName('help')
        .setDescription('Show all when2play commands'),
    new SlashCommandBuilder()
        .setName('setchannel')
        .setDescription('Set this channel as the when2play output channel (requires ADMINISTRATOR)'),
];

async function registerCommands() {
    const rest = new REST().setToken(DISCORD_TOKEN);
    const body = commands.map(c => c.toJSON());
    if (GUILD_ID) {
        await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), { body });
        // Clear stale global commands so old commands like /judge don't linger
        await rest.put(Routes.applicationCommands(client.user.id), { body: [] });
        console.log(`Slash commands registered (guild: ${GUILD_ID}).`);
    } else {
        await rest.put(Routes.applicationCommands(client.user.id), { body });
        console.log('Slash commands registered (global — may take up to 1h to propagate).');
    }
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
                discord_username: interaction.member?.displayName ?? interaction.user.displayName,
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

// --- Helper: resolve Discord user ID to when2play user ID via auth token flow ---
async function ensureUser(discordUser, guildMember) {
    const res = await fetch(`${API_URL}/api/auth/token`, {
        method: 'POST',
        headers: botHeaders,
        body: JSON.stringify({
            discord_id: discordUser.id,
            discord_username: guildMember?.displayName ?? discordUser.displayName ?? discordUser.username,
            avatar_url: discordUser.displayAvatarURL?.({ size: 128 }) ?? null,
        }),
    });
    const json = await res.json();
    if (!json.ok) return null;
    const token = json.data.token;
    const cbRes = await fetch(`${API_URL}/api/auth/callback/${token}`, { headers: botHeaders });
    const cbJson = await cbRes.json();
    if (!cbJson.ok) return null;
    return cbJson.data; // { user, session }
}

// --- Helper: make an authenticated API call on behalf of a user session ---
async function apiCallWithSession(sessionId, path, options = {}) {
    const res = await fetch(`${API_URL}${path}`, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            'Cookie': `session_id=${sessionId}`,
            ...(options.headers || {}),
        },
    });
    return res.json();
}

// --- /url handler ---
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'url') return;
    await interaction.deferReply({ flags: 64 });
    await interaction.editReply(API_URL);
});

// --- Rally command handlers ---
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName } = interaction;

    if (!['call', 'in', 'out', 'ping', 'brb', 'where', 'call2select', 'post'].includes(commandName)) return;

    await interaction.deferReply({ flags: 64 });

    try {
        const authData = await ensureUser(interaction.user, interaction.member);
        if (!authData) {
            await interaction.editReply('Could not authenticate. Try `/play` first to set up your account.');
            return;
        }
        const { session } = authData;

        if (commandName === 'call') {
            const message = interaction.options.getString('message') ?? undefined;
            const json = await apiCallWithSession(session.session_id, '/api/rally/call', {
                method: 'POST',
                body: JSON.stringify({ message }),
            });
            if (!json.ok) {
                await interaction.editReply(`Failed: ${json.error.message}`);
                return;
            }
            await interaction.editReply('Rally started!');
        }

        else if (commandName === 'in') {
            const message = interaction.options.getString('message') ?? undefined;
            const json = await apiCallWithSession(session.session_id, '/api/rally/action', {
                method: 'POST',
                body: JSON.stringify({ action_type: 'in', message }),
            });
            if (!json.ok) {
                await interaction.editReply(`Failed: ${json.error.message}`);
                return;
            }
            await interaction.editReply("You're in!");
        }

        else if (commandName === 'out') {
            const reason = interaction.options.getString('reason') ?? undefined;
            const json = await apiCallWithSession(session.session_id, '/api/rally/action', {
                method: 'POST',
                body: JSON.stringify({ action_type: 'out', message: reason }),
            });
            if (!json.ok) {
                await interaction.editReply(`Failed: ${json.error.message}`);
                return;
            }
            await interaction.editReply("You're out.");
        }

        else if (commandName === 'ping') {
            const targetDiscordUser = interaction.options.getUser('user', true);
            const message = interaction.options.getString('message') ?? undefined;
            const targetAuth = await ensureUser(targetDiscordUser);
            if (!targetAuth) {
                await interaction.editReply('Could not find that user. They may need to use `/play` first.');
                return;
            }
            const json = await apiCallWithSession(session.session_id, '/api/rally/action', {
                method: 'POST',
                body: JSON.stringify({ action_type: 'ping', target_user_ids: [targetAuth.user.id], message }),
            });
            if (!json.ok) {
                await interaction.editReply(`Failed: ${json.error.message}`);
                return;
            }
            await interaction.editReply(`Pinged ${targetDiscordUser.displayName}!`);
        }

        else if (commandName === 'brb') {
            const message = interaction.options.getString('message') ?? undefined;
            const json = await apiCallWithSession(session.session_id, '/api/rally/action', {
                method: 'POST',
                body: JSON.stringify({ action_type: 'brb', message }),
            });
            if (!json.ok) {
                await interaction.editReply(`Failed: ${json.error.message}`);
                return;
            }
            await interaction.editReply('Marked as BRB.');
        }

        else if (commandName === 'where') {
            const targetDiscordUser = interaction.options.getUser('user', true);
            const targetAuth = await ensureUser(targetDiscordUser);
            if (!targetAuth) {
                await interaction.editReply('Could not find that user.');
                return;
            }
            const json = await apiCallWithSession(session.session_id, '/api/rally/action', {
                method: 'POST',
                body: JSON.stringify({ action_type: 'where', target_user_ids: [targetAuth.user.id] }),
            });
            if (!json.ok) {
                await interaction.editReply(`Failed: ${json.error.message}`);
                return;
            }
            await interaction.editReply(`Asked where ${targetDiscordUser.displayName} is.`);
        }

        else if (commandName === 'call2select') {
            const targetDiscordUser = interaction.options.getUser('user', true);
            const targetAuth = await ensureUser(targetDiscordUser);
            if (!targetAuth) {
                await interaction.editReply('Could not find that user. They may need to use `/play` first.');
                return;
            }
            const json = await apiCallWithSession(session.session_id, '/api/rally/judge/avail', {
                method: 'POST',
                body: JSON.stringify({ target_user_ids: [targetAuth.user.id] }),
            });
            if (!json.ok) {
                await interaction.editReply(`Failed: ${json.error.message}`);
                return;
            }
            await interaction.editReply(`Nudged ${targetDiscordUser.displayName} to set their availability.`);
        }

        else if (commandName === 'post') {
            const sub = interaction.options.getSubcommand();

            if (sub === 'schedule') {
                const json = await apiCallWithSession(session.session_id, '/api/rally/judge/time', {
                    method: 'POST',
                });
                if (!json.ok) {
                    await interaction.editReply(`Failed: ${json.error.message}`);
                    return;
                }
                const meta = json.data?.metadata;
                if (!meta?.windows?.length) {
                    await interaction.editReply('No overlapping availability windows found today. Ask everyone to set their times!');
                    return;
                }
                const fmtNames = (w) => (w.user_names?.map(n => n.trim()).join(', ') ?? `${w.user_count} people`);
                const fmt = (t) => fmtDiscordTime(t, meta.day_key);
                const best = meta.windows[0];
                let reply = `📅 **Best window:** ${fmt(best.start)}–${fmt(best.end)} (${fmtNames(best)})`;
                const allLines = meta.windows.slice(0, 8).map(w => `• ${fmt(w.start)}–${fmt(w.end)}: ${fmtNames(w)}`);
                reply += `\n📋 **All windows today (${meta.windows.length}):**\n${allLines.join('\n')}`;
                await interaction.editReply(reply);
            }

            else if (sub === 'gamerank') {
                const json = await apiCallWithSession(session.session_id, '/api/rally/share-ranking', {
                    method: 'POST',
                });
                if (!json.ok) {
                    await interaction.editReply(`Failed: ${json.error.message}`);
                    return;
                }
                await interaction.editReply('Game rankings posted to the channel!');
            }

            else if (sub === 'gametree') {
                const res = await fetch(`${API_URL}/api/rally/active`, {
                    headers: { ...botHeaders, 'Cookie': `session_id=${session.session_id}` },
                });
                const json = await res.json();
                if (!json.ok || !json.data.rally) {
                    await interaction.editReply('No active rally today. Use `/call` to start one!');
                    return;
                }
                const channelId = getChannelId();
                if (!channelId) {
                    await interaction.editReply('No output channel configured. An admin should run `/setchannel` first.');
                    return;
                }
                const { rally, actions } = json.data;
                let summary = `**Gaming Tree** — ${rally.day_key}\n`;
                if (actions.length === 0) {
                    summary += 'No actions yet.';
                } else {
                    for (const a of actions) {
                        const icon = { call: '📢', in: '✅', out: '❌', ping: '👋', judge_time: '🤖', judge_avail: '🤖', brb: '⏳', where: '❓' }[a.action_type] ?? '•';
                        summary += `${icon} **${a.actor_username}**: ${a.action_type}${a.message ? ` — ${a.message}` : ''}\n`;
                    }
                }
                const channel = await client.channels.fetch(channelId);
                if (channel?.isTextBased()) {
                    const actor = authData.user.display_name ?? authData.user.discord_username;
                    await channel.send({ content: `${summary}_On behalf of ${actor}_`, allowedMentions: { parse: [], users: [] } });
                }
                await interaction.editReply('Gaming tree posted to the channel!');
            }
        }

    } catch (err) {
        console.error(`Error handling /${commandName}:`, err);
        await interaction.editReply('Something went wrong. Is the when2play server running?');
    }
});

// Convert a UTC HH:MM time + YYYY-MM-DD day_key to a Discord timestamp token
// that renders in each viewer's local timezone automatically.
function fmtDiscordTime(utcHHMM, dayKey) {
    const ts = Math.floor(new Date(`${dayKey}T${utcHHMM}:00Z`).getTime() / 1000);
    return `<t:${ts}:t>`;
}

// --- Rally action polling ---
async function pollRallyActions() {
    try {
        const channelId = getChannelId();
        if (!channelId) return;

        const res = await fetch(`${API_URL}/api/rally/pending`, { headers: botHeaders });
        const json = await res.json();
        if (!json.ok || json.data.length === 0) return;

        const channel = await client.channels.fetch(channelId);
        if (!channel?.isTextBased()) return;

        for (const action of json.data) {
            // Use bold plaintext name instead of @mention to avoid pinging the sender
            const actor = `**${action.actor_username}**`;
            let text = '';

            switch (action.action_type) {
                case 'call':
                    text = `📢 ${actor} called${action.message ? ` — "${action.message}"` : ''}`;
                    break;
                case 'in':
                    text = `✅ ${actor} is in${action.message ? ` — "${action.message}"` : '!'}`;
                    break;
                case 'out':
                    text = `❌ ${actor} is out${action.message ? ` — "${action.message}"` : ''}`;
                    break;
                case 'ping': {
                    const targets = action.target_discord_ids?.map(id => `<@${id}>`).join(', ') ?? 'someone';
                    text = `👋 ${actor} → ${targets}${action.message ? ` — "${action.message}"` : ''}`;
                    break;
                }
                case 'judge_time': {
                    const meta = action.metadata;
                    if (meta?.windows?.length > 0) {
                        const fmtNames = (w) => (w.user_names?.map(n => n.trim()).join(', ') ?? `${w.user_count} people`);
                        const fmt = (t) => fmtDiscordTime(t, meta.day_key);
                        const best = meta.windows[0];
                        text = `📅 **Best window:** ${fmt(best.start)}–${fmt(best.end)} (${fmtNames(best)})`;
                        const allLines = meta.windows.slice(0, 8).map(w => `• ${fmt(w.start)}–${fmt(w.end)}: ${fmtNames(w)}`);
                        text += `\n📋 **All windows today (${meta.windows.length}):**\n${allLines.join('\n')}`;
                        text += `\n_On behalf of ${action.actor_username}_`;
                    } else {
                        text = `🤖 No overlapping availability found today. Ask everyone to set their times!\n_On behalf of ${action.actor_username}_`;
                    }
                    break;
                }
                case 'judge_avail': {
                    const targets = action.target_discord_ids?.map(id => `<@${id}>`).join(', ') ?? 'someone';
                    text = `🤖 ${actor} → ${targets}: Please set your availability!`;
                    break;
                }
                case 'brb':
                    text = `⏳ ${actor} brb${action.message ? ` — "${action.message}"` : ''}`;
                    break;
                case 'where': {
                    const targets = action.target_discord_ids?.map(id => `<@${id}>`).join(', ') ?? 'someone';
                    text = `❓ ${actor} → ${targets}${action.message ? ` — "${action.message}"` : ''}`;
                    break;
                }
                case 'share_ranking': {
                    const meta = action.metadata;
                    if (meta?.ranking?.length > 0) {
                        const lines = meta.ranking.map((r, i) =>
                            `#${i + 1} ${r.name} (${r.total_score} pts, ${r.vote_count} votes)`
                        );
                        text = `🏆 **Game Rankings:**\n${lines.join('\n')}\n_On behalf of ${action.actor_username}_`;
                    } else {
                        text = `🏆 ${actor} shared rankings — no games ranked yet`;
                    }
                    break;
                }
                default:
                    text = `${actor}: ${action.action_type}`;
            }

            if (text) await channel.send({ content: text, allowedMentions: { parse: [], users: action.target_discord_ids ?? [] } });

            await fetch(`${API_URL}/api/rally/${action.id}/delivered`, {
                method: 'PATCH',
                headers: botHeaders,
            });
        }
    } catch (err) {
        logError('polling rally actions', err);
        console.error('Error polling rally actions:', err);
    }
}

// --- Tree share polling ---
async function pollTreeShares() {
    try {
        const channelId = getChannelId();
        if (!channelId) return;

        const res = await fetch(`${API_URL}/api/rally/tree/share/pending`, { headers: botHeaders });
        const json = await res.json();
        if (!json.ok || json.data.length === 0) return;

        const channel = await client.channels.fetch(channelId);
        if (!channel?.isTextBased()) return;

        for (const share of json.data) {
            if (share.image_data) {
                const buffer = Buffer.from(share.image_data, 'base64');
                const attachment = new AttachmentBuilder(buffer, { name: `gaming-tree-${share.day_key}.png` });
                await channel.send({ content: `📊 **Gaming Tree** — ${share.day_key}`, files: [attachment], allowedMentions: { parse: [], users: [] } });
            }

            await fetch(`${API_URL}/api/rally/tree/share/${share.id}/delivered`, {
                method: 'PATCH',
                headers: botHeaders,
            });
        }
    } catch (err) {
        logError('polling tree shares', err);
        console.error('Error polling tree shares:', err);
    }
}

// Gather ping polling
async function pollGatherPings() {
    try {
        const channelId = getChannelId();
        if (!channelId) {
            consecutiveErrors = 0;
            return;
        }

        const res = await fetch(`${API_URL}/api/gather/pending`, { headers: botHeaders });
        const json = await res.json();
        if (!json.ok || json.data.length === 0) {
            consecutiveErrors = 0;
            return;
        }

        const channel = await client.channels.fetch(channelId);
        if (!channel?.isTextBased()) {
            consecutiveErrors = 0;
            return;
        }

        for (const ping of json.data) {
            const sender = ping.is_anonymous ? 'Someone' : `<@${ping.sender_discord_id}>`;
            const msg = ping.message || 'Ready to play!';
            let text = `🔔 **Gather bell!** ${sender}: ${msg}`;

            if (ping.target_discord_ids && ping.target_discord_ids.length > 0) {
                const mentions = ping.target_discord_ids.map((id) => `<@${id}>`).join(' ');
                text += ` → ${mentions}`;
            }

            const intentionalUsers = [
                ...(ping.is_anonymous ? [] : [ping.sender_discord_id]),
                ...(ping.target_discord_ids ?? []),
            ].filter(Boolean);
            await channel.send({ content: text, allowedMentions: { parse: [], users: intentionalUsers } });
            await fetch(`${API_URL}/api/gather/${ping.id}/delivered`, {
                method: 'PATCH',
                headers: botHeaders,
            });
        }
        consecutiveErrors = 0;
    } catch (err) {
        consecutiveErrors++;
        logError(`polling gather pings (consecutive errors: ${consecutiveErrors})`, err);
        console.error(`Error polling gather pings (consecutive errors: ${consecutiveErrors}):`, err);
    }
}

// --- /help handler ---
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'help') return;
    await interaction.deferReply({ flags: 64 });

    const helpText = [
        '**when2play** — Gaming coordination bot\n',
        '**Getting Started**',
        '`/play` — Get a login link for the when2play dashboard',
        '`/url` — Get the when2play website URL\n',
        '**Rally — Session Coordination**',
        '`/call [message]` — Call everyone to play',
        '`/in [message]` — Join the rally',
        '`/out [reason]` — Bail from the rally',
        '`/brb [message]` — Mark yourself as away briefly',
        '`/ping @user [message]` — Ping someone to come play',
        '`/where @user` — Ask where someone is\n',
        '**Scheduling**',
        '`/call2select @user` — Nudge someone to set their availability',
        '`/post schedule` — Find and post the best overlapping time windows today\n',
        '**Post to Channel**',
        '`/post gamerank` — Post the current game rankings',
        '`/post gametree` — Post today\'s gaming tree diagram\n',
        '**Admin**',
        '`/setchannel` — Set the current channel as the bot output channel',
        '`/when2play-admin` — Get an admin link\n',
        '**Dashboard Features**',
        'The web dashboard at the `/play` link also includes:',
        '- Schedule — Set your daily availability grid',
        '- Games — Vote and rank games to play',
        '- Shame Wall — Call out friends who bailed',
        '- Gaming Tree — Visualize today\'s rally as a DAG',
    ].join('\n');

    await interaction.editReply(helpText);
});

function scheduleNextPoll() {
    const delay = consecutiveErrors === 0
        ? BASE_POLL_MS
        : Math.min(BASE_POLL_MS * Math.pow(2, consecutiveErrors - 1), MAX_POLL_MS);
    setTimeout(async () => {
        await Promise.all([
            pollGatherPings(),
            pollRallyActions(),
            pollTreeShares(),
        ]);
        scheduleNextPoll();
    }, delay);
}

client.once('clientReady', async () => {
    console.log(`Logged in as ${client.user.tag}`);
    await registerCommands();
    scheduleNextPoll();
    console.log(`Polling for gather pings, rally actions, and tree shares every ${BASE_POLL_MS / 1000}s (with exponential backoff on errors)`);
});

client.login(DISCORD_TOKEN);


// Handle the interaction
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'when2play-admin') return;
    await interaction.deferReply({ flags: 64 }); // ephemeral

    // Gate: require ADMINISTRATOR permission
    if (!interaction.memberPermissions?.has('Administrator')) {
        await interaction.editReply('You need the ADMINISTRATOR permission to use this command.');
        return;
    }

    try {
        const res = await fetch(`${API_URL}/api/auth/admin-token`, {
            method: 'POST',
            headers: botHeaders,
            body: JSON.stringify({
                discord_id: interaction.user.id,
                discord_username: interaction.member?.displayName ?? interaction.user.displayName,
                avatar_url: interaction.user.displayAvatarURL({ size: 128 }),
            }),
        });
        const json = await res.json();

        if (!json.ok) {
            await interaction.editReply(`Failed: ${json.error.message}`);
            return;
        }

        try {
            await interaction.user.send(`Admin link for **when2play** (expires in 10 min, session lasts 1h):\n${json.data.url}`);
            await interaction.editReply('Check your DMs for the admin link!');
        } catch {
            await interaction.editReply(`Admin link (expires in 10 min):\n${json.data.url}`);
        }
    } catch (err) {
        console.error('Error handling /when2play-admin:', err);
        await interaction.editReply('Something went wrong.');
    }
});

// --- /setchannel handler ---
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'setchannel') return;
    await interaction.deferReply({ flags: 64 });

    if (!interaction.memberPermissions?.has('Administrator')) {
        await interaction.editReply('You need the ADMINISTRATOR permission to use this command.');
        return;
    }

    try {
        const config = loadConfig();
        config.channelId = interaction.channelId;
        saveConfig(config);
        await interaction.editReply(`Messages will now be sent to <#${interaction.channelId}>.`);
    } catch (err) {
        console.error('Error handling /setchannel:', err);
        await interaction.editReply('Failed to save channel configuration.');
    }
});
