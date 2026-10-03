import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, AttachmentBuilder } from 'discord.js';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { createPoller, fmtDiscordTime, formatRallyAction, formatTreeShare, formatGameShare } from './lib/poller.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ERROR_LOG_PATH = join(__dirname, 'errors.log');

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const API_URL = process.env.WHEN2PLAY_API_URL;
const BOT_API_KEY = process.env.BOT_API_KEY;
const GAMING_CHANNEL_ID = process.env.GAMING_CHANNEL_ID;
const DRY_RUN = process.env.W2P_DRY_RUN === '1';
const ENV_POLL_MS = Number(process.env.POLL_INTERVAL_MS);
const BASE_POLL_MS = Number.isFinite(ENV_POLL_MS) && ENV_POLL_MS >= 5000 ? ENV_POLL_MS : 15_000;
const MAX_POLL_MS = 2 * 60 * 1000;
const API_TIMEOUT_MS = 10_000;

if (!DISCORD_TOKEN || !API_URL) {
    console.error('Missing required env vars (DISCORD_TOKEN, WHEN2PLAY_API_URL)');
    process.exit(1);
}

function logError(context, err) {
    const ts = new Date().toISOString();
    const message = err?.message ?? String(err);
    const cause = err?.cause ? ` | cause: ${err.cause.message ?? err.cause}` : '';
    const line = `[${ts}] ${context}: ${message}${cause}\n`;
    try { appendFileSync(ERROR_LOG_PATH, line); } catch {}
}

async function safeJson(res) {
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    return res.json();
}

function buildGuildHeaders(guildId) {
    return {
        'Content-Type': 'application/json',
        ...(BOT_API_KEY ? { 'X-Bot-Token': BOT_API_KEY } : {}),
        ...(guildId ? { 'X-Guild-Id': guildId } : {}),
    };
}

/** Every request to the Worker goes through here: bot headers plus a request timeout. */
function apiFetch(path, options = {}, guildId) {
    return fetch(`${API_URL}${path}`, {
        ...options,
        headers: { ...buildGuildHeaders(guildId), ...(options.headers || {}) },
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
}

// In-memory guild config cache, populated from D1 on startup
let cachedConfig = { guilds: {} };

function getChannelId(guildId) {
    return cachedConfig.guilds?.[guildId]?.channelId || GAMING_CHANNEL_ID || null;
}

/** Fetch channel_id setting from the API for a given guild and update cache. */
async function fetchGuildSettings(guildId) {
    try {
        const res = await apiFetch('/api/settings/bot', {}, guildId);
        const json = await safeJson(res);
        if (json.ok && json.data.channel_id) {
            cachedConfig.guilds ??= {};
            cachedConfig.guilds[guildId] = {
                ...(cachedConfig.guilds[guildId] || {}),
                channelId: json.data.channel_id,
            };
        }
    } catch (err) {
        logError(`fetchGuildSettings(${guildId})`, err);
    }
}

/** Save channel_id to D1 via the API. */
async function saveChannelToApi(guildId, channelId) {
    const res = await apiFetch('/api/settings/bot', {
        method: 'PATCH',
        body: JSON.stringify({ channel_id: channelId }),
    }, guildId);
    return safeJson(res);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const rest = new REST().setToken(DISCORD_TOKEN);

const commands = [
    new SlashCommandBuilder().setName('when2play').setDescription('Get a login link for when2play'),
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
        .addUserOption(o => o.setName('user').setDescription('Who to nudge').setRequired(true))
        .addStringOption(o => o.setName('message').setDescription('Optional message').setRequired(false)),
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
    new SlashCommandBuilder()
        .setName('welcome')
        .setDescription('Post a welcome message introducing when2play (requires ADMINISTRATOR)'),
];
const commandBody = commands.map(c => c.toJSON());

function registerGuildCommands(guildId) {
    return rest.put(Routes.applicationGuildCommands(client.user.id, guildId), { body: commandBody });
}

async function registerCommands() {
    // Register guild-scoped commands (instant) for every guild the bot is in
    const guilds = client.guilds.cache;
    if (guilds.size > 0) {
        await Promise.all(guilds.map(g => registerGuildCommands(g.id)));
        // Clear stale global commands so old commands don't linger
        await rest.put(Routes.applicationCommands(client.user.id), { body: [] });
        console.log(`Slash commands registered (${guilds.size} guild(s): ${guilds.map(g => g.id).join(', ')}).`);
    } else {
        await rest.put(Routes.applicationCommands(client.user.id), { body: commandBody });
        console.log('Slash commands registered (global -- may take up to 1h to propagate).');
    }
}

/**
 * Register a slash-command handler. Nothing the handler throws or rejects with escapes:
 * it is logged and the user gets a generic error reply (itself guarded).
 */
function onCommand(names, handler) {
    const wanted = new Set(Array.isArray(names) ? names : [names]);
    client.on('interactionCreate', async (interaction) => {
        try {
            if (!interaction.isChatInputCommand() || !wanted.has(interaction.commandName)) return;
            await handler(interaction);
        } catch (err) {
            const name = interaction?.commandName ?? 'unknown';
            logError(`/${name} handler`, err);
            console.error(`Unhandled error in /${name}:`, err);
            try {
                if (interaction.deferred || interaction.replied) {
                    await interaction.editReply('Something went wrong.');
                } else {
                    await interaction.reply({ content: 'Something went wrong.', flags: 64 });
                }
            } catch (replyErr) {
                logError(`/${name} error reply`, replyErr);
            }
        }
    });
}

// --- /when2play handler ---
onCommand('when2play', async (interaction) => {
    if (!interaction.guildId) {
        await interaction.reply({ content: 'This command can only be used in a server.', flags: 64 });
        return;
    }
    await interaction.deferReply({ flags: 64 });

    try {
        const res = await apiFetch('/api/auth/token', {
            method: 'POST',
            body: JSON.stringify({
                discord_id: interaction.user.id,
                discord_username: interaction.member?.displayName ?? interaction.user.displayName,
                avatar_url: interaction.user.displayAvatarURL({ size: 128 }),
                guild_name: interaction.guild?.name,
            }),
        }, interaction.guildId);
        const json = await safeJson(res);

        if (!json.ok) {
            await interaction.editReply(`Failed: ${json.error.message}`);
            return;
        }

        await interaction.editReply(`Click to open **when2play**: ${json.data.url}\n\nExpires in 10 minutes.`);
    } catch (err) {
        console.error('Error handling /when2play:', err);
        await interaction.editReply('Something went wrong. Is the when2play server running?');
    }
});

// --- Helper: resolve Discord user ID to when2play user ID via auth token flow ---
async function ensureUser(discordUser, guildMember, guildId) {
    const res = await apiFetch('/api/auth/token', {
        method: 'POST',
        body: JSON.stringify({
            discord_id: discordUser.id,
            discord_username: guildMember?.displayName ?? discordUser.displayName ?? discordUser.username,
            avatar_url: discordUser.displayAvatarURL?.({ size: 128 }) ?? null,
            guild_name: guildId ? client.guilds.cache.get(guildId)?.name : undefined,
        }),
    }, guildId);
    const json = await safeJson(res);
    if (!json.ok) return null;
    const token = json.data.token;
    const cbRes = await apiFetch(`/api/auth/callback/${token}`, {}, guildId);
    const cbJson = await safeJson(cbRes);
    if (!cbJson.ok) return null;
    return cbJson.data; // { user, session }
}

// --- Helper: make an authenticated API call on behalf of a user session ---
async function apiCallWithSession(sessionId, path, options = {}, guildId) {
    const res = await apiFetch(path, {
        ...options,
        headers: {
            'Cookie': `session_id=${sessionId}`,
            ...(options.headers || {}),
        },
    }, guildId);
    return safeJson(res);
}

// --- /url handler ---
onCommand('url', async (interaction) => {
    await interaction.deferReply({ flags: 64 });
    await interaction.editReply(API_URL);
});

// --- Rally command handlers ---
onCommand(['call', 'in', 'out', 'ping', 'brb', 'where', 'call2select', 'post'], async (interaction) => {
    const { commandName } = interaction;

    if (!interaction.guildId) {
        await interaction.reply({ content: 'This command can only be used in a server.', flags: 64 });
        return;
    }

    await interaction.deferReply({ flags: 64 });

    try {
        const authData = await ensureUser(interaction.user, interaction.member, interaction.guildId);
        if (!authData) {
            await interaction.editReply('Could not authenticate. Try `/when2play` first to set up your account.');
            return;
        }
        const { session } = authData;

        if (commandName === 'call') {
            const message = interaction.options.getString('message') ?? undefined;
            const json = await apiCallWithSession(session.session_id, '/api/rally/call', {
                method: 'POST',
                body: JSON.stringify({ message }),
            }, interaction.guildId);
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
            }, interaction.guildId);
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
            }, interaction.guildId);
            if (!json.ok) {
                await interaction.editReply(`Failed: ${json.error.message}`);
                return;
            }
            await interaction.editReply("You're out.");
        }

        else if (commandName === 'ping') {
            const targetDiscordUser = interaction.options.getUser('user', true);
            const message = interaction.options.getString('message') ?? undefined;
            const targetAuth = await ensureUser(targetDiscordUser, null, interaction.guildId);
            if (!targetAuth) {
                await interaction.editReply('Could not find that user. They may need to use `/when2play` first.');
                return;
            }
            const json = await apiCallWithSession(session.session_id, '/api/rally/action', {
                method: 'POST',
                body: JSON.stringify({ action_type: 'ping', target_user_ids: [targetAuth.user.id], message }),
            }, interaction.guildId);
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
            }, interaction.guildId);
            if (!json.ok) {
                await interaction.editReply(`Failed: ${json.error.message}`);
                return;
            }
            await interaction.editReply('Marked as BRB.');
        }

        else if (commandName === 'where') {
            const targetDiscordUser = interaction.options.getUser('user', true);
            const targetAuth = await ensureUser(targetDiscordUser, null, interaction.guildId);
            if (!targetAuth) {
                await interaction.editReply('Could not find that user.');
                return;
            }
            const json = await apiCallWithSession(session.session_id, '/api/rally/action', {
                method: 'POST',
                body: JSON.stringify({ action_type: 'where', target_user_ids: [targetAuth.user.id] }),
            }, interaction.guildId);
            if (!json.ok) {
                await interaction.editReply(`Failed: ${json.error.message}`);
                return;
            }
            await interaction.editReply(`Asked where ${targetDiscordUser.displayName} is.`);
        }

        else if (commandName === 'call2select') {
            const targetDiscordUser = interaction.options.getUser('user', true);
            const message = interaction.options.getString('message') ?? undefined;
            const targetAuth = await ensureUser(targetDiscordUser, null, interaction.guildId);
            if (!targetAuth) {
                await interaction.editReply('Could not find that user. They may need to use `/when2play` first.');
                return;
            }
            const json = await apiCallWithSession(session.session_id, '/api/rally/judge/avail', {
                method: 'POST',
                body: JSON.stringify({ target_user_ids: [targetAuth.user.id], message }),
            }, interaction.guildId);
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
                }, interaction.guildId);
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
                let reply = `📅 **Best window:** ${fmt(best.start)}--${fmt(best.end)} (${fmtNames(best)})`;
                const allLines = meta.windows.slice(0, 8).map(w => `• ${fmt(w.start)}--${fmt(w.end)}: ${fmtNames(w)}`);
                reply += `\n📋 **All windows today (${meta.windows.length}):**\n${allLines.join('\n')}`;
                await interaction.editReply(reply);
            }

            else if (sub === 'gamerank') {
                const json = await apiCallWithSession(session.session_id, '/api/rally/share-ranking', {
                    method: 'POST',
                }, interaction.guildId);
                if (!json.ok) {
                    await interaction.editReply(`Failed: ${json.error.message}`);
                    return;
                }
                await interaction.editReply('Game rankings posted to the channel!');
            }

            else if (sub === 'gametree') {
                const res = await apiFetch('/api/rally/active', {
                    headers: { 'Cookie': `session_id=${session.session_id}` },
                }, interaction.guildId);
                const json = await safeJson(res);
                if (!json.ok || !json.data.rally) {
                    await interaction.editReply('No active rally today. Use `/call` to start one!');
                    return;
                }
                const channelId = getChannelId(interaction.guildId);
                if (!channelId) {
                    await interaction.editReply('No output channel configured. An admin should run `/setchannel` first.');
                    return;
                }
                const { rally, actions } = json.data;
                let summary = `**Gaming Tree** -- ${rally.day_key}\n`;
                if (actions.length === 0) {
                    summary += 'No actions yet.';
                } else {
                    for (const a of actions) {
                        const icon = { call: '📢', in: '✅', out: '❌', ping: '👋', judge_time: '🤖', judge_avail: '🤖', brb: '⏳', where: '❓' }[a.action_type] ?? '•';
                        summary += `${icon} **${a.actor_username}**: ${a.action_type}${a.message ? ` -- ${a.message}` : ''}\n`;
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

// --- /help handler ---
onCommand('help', async (interaction) => {
    await interaction.deferReply({ flags: 64 });

    const helpText = [
        '**when2play** -- Gaming coordination bot\n',
        '**Getting Started**',
        '`/when2play` -- Get a login link for the when2play dashboard',
        '`/url` -- Get the when2play website URL\n',
        '**Rally -- Session Coordination**',
        '`/call [message]` -- Call everyone to play',
        '`/in [message]` -- Join the rally',
        '`/out [reason]` -- Bail from the rally',
        '`/brb [message]` -- Mark yourself as away briefly',
        '`/ping @user [message]` -- Ping someone to come play',
        '`/where @user` -- Ask where someone is\n',
        '**Scheduling**',
        '`/call2select @user` -- Nudge someone to set their availability',
        '`/post schedule` -- Find and post the best overlapping time windows today\n',
        '**Post to Channel**',
        '`/post gamerank` -- Post the current game rankings',
        '`/post gametree` -- Post today\'s gaming tree diagram\n',
        '**Admin**',
        '`/setchannel` -- Set the current channel as the bot output channel',
        '`/welcome` -- Post a welcome message introducing when2play',
        '`/when2play-admin` -- Get an admin link\n',
        '**Dashboard Features**',
        'The web dashboard at the `/when2play` link also includes:',
        '- Schedule -- Set your daily availability grid',
        '- Games -- Vote and rank games to play',
        '- Shame Wall -- Call out friends who bailed',
        '- Gaming Tree -- Visualize today\'s rally as a DAG',
    ].join('\n');

    await interaction.editReply(helpText);
});

// --- /when2play-admin handler ---
onCommand('when2play-admin', async (interaction) => {
    if (!interaction.guildId) {
        await interaction.reply({ content: 'This command can only be used in a server.', flags: 64 });
        return;
    }
    await interaction.deferReply({ flags: 64 }); // ephemeral

    // Gate: require ADMINISTRATOR permission
    if (!interaction.memberPermissions?.has('Administrator')) {
        await interaction.editReply('You need the ADMINISTRATOR permission to use this command.');
        return;
    }

    try {
        const res = await apiFetch('/api/auth/admin-token', {
            method: 'POST',
            body: JSON.stringify({
                discord_id: interaction.user.id,
                discord_username: interaction.member?.displayName ?? interaction.user.displayName,
                avatar_url: interaction.user.displayAvatarURL({ size: 128 }),
                guild_name: interaction.guild?.name,
            }),
        }, interaction.guildId);
        const json = await safeJson(res);

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
onCommand('setchannel', async (interaction) => {
    if (!interaction.guildId) {
        await interaction.reply({ content: 'This command can only be used in a server.', flags: 64 });
        return;
    }
    await interaction.deferReply({ flags: 64 });

    if (!interaction.memberPermissions?.has('Administrator')) {
        await interaction.editReply('You need the ADMINISTRATOR permission to use this command.');
        return;
    }

    try {
        await saveChannelToApi(interaction.guildId, interaction.channelId);
        cachedConfig.guilds ??= {};
        cachedConfig.guilds[interaction.guildId] = {
            ...(cachedConfig.guilds[interaction.guildId] || {}),
            channelId: interaction.channelId,
        };
        await interaction.editReply(`Messages will now be sent to <#${interaction.channelId}>.`);
    } catch (err) {
        console.error('Error handling /setchannel:', err);
        await interaction.editReply('Failed to save channel configuration.');
    }
});

// --- /welcome handler ---
onCommand('welcome', async (interaction) => {
    if (!interaction.guildId) {
        await interaction.reply({ content: 'This command can only be used in a server.', flags: 64 });
        return;
    }
    await interaction.deferReply({ flags: 64 });

    if (!interaction.memberPermissions?.has('Administrator')) {
        await interaction.editReply('You need the ADMINISTRATOR permission to use this command.');
        return;
    }

    try {
        await interaction.channel.send(
            '**when2play** -- Your group\'s gaming coordinator.\n\n'
            + '**Getting started:**\n'
            + '`/when2play` -- Register and get your personal login link. Each server has its own profile, so use this once per server.\n'
            + '`/url` -- Revisit the website anytime (your session is remembered).\n\n'
            + 'Explore the web dashboard to set your availability, vote on games, and more. Type `/help` for a full list of Discord commands.'
        );
        await interaction.editReply('Welcome message posted!');
    } catch (err) {
        console.error('Error handling /welcome:', err);
        await interaction.editReply('Failed to post the welcome message.');
    }
});

// --- Delivery of pending items (rally actions, tree shares, game shares) ---
async function deliverItem(guildId, kind, item) {
    const channelId = getChannelId(guildId);
    if (!channelId) throw new Error(`no output channel configured for guild ${guildId}`);
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased()) throw new Error(`channel ${channelId} is missing or not text-based`);

    if (kind === 'rally_actions') {
        const { text, mentionUsers } = formatRallyAction(item);
        if (text) await channel.send({ content: text, allowedMentions: { parse: [], users: mentionUsers } });
    } else if (kind === 'tree_shares') {
        const share = formatTreeShare(item);
        if (share) {
            const buffer = Buffer.from(item.image_data, 'base64');
            const attachment = new AttachmentBuilder(buffer, { name: share.fileName });
            await channel.send({ content: share.content, files: [attachment], allowedMentions: { parse: [], users: [] } });
        }
    } else if (kind === 'game_shares') {
        const { content, embeds } = formatGameShare(item);
        const msgPayload = { content, allowedMentions: { parse: [], users: [] } };
        if (embeds) msgPayload.embeds = embeds;
        await channel.send(msgPayload);
    } else {
        throw new Error(`unknown delivery kind ${kind}`);
    }
}

const poller = createPoller({
    fetch: (...args) => fetch(...args),
    apiUrl: API_URL,
    getHeaders: () => buildGuildHeaders(null),
    // Only guilds with an output channel have anywhere to deliver to
    getGuildIds: () => client.guilds.cache.map(g => g.id).filter(id => getChannelId(id)),
    deliver: deliverItem,
    logError,
    consoleError: (...args) => console.error(...args),
    baseIntervalMs: BASE_POLL_MS,
    maxIntervalMs: MAX_POLL_MS,
});

client.on('error', (err) => {
    logError('client error', err);
    console.error('Discord client error:', err);
});

client.on('shardError', (err, shardId) => {
    logError(`shard ${shardId} error`, err);
    console.error(`Discord shard ${shardId} error:`, err);
});

client.once('clientReady', async () => {
    try {
        console.log(`Logged in as ${client.user.tag}`);
        try {
            await registerCommands();
        } catch (err) {
            logError('registerCommands', err);
            console.error('Failed to register slash commands:', err);
        }

        // Populate guild config from D1 for each guild the bot is in
        const guilds = client.guilds.cache;
        try {
            await Promise.all(guilds.map(g => fetchGuildSettings(g.id)));
            console.log(`Loaded settings for ${guilds.size} guild(s) from D1`);
        } catch (err) {
            logError('loading guild settings', err);
            console.error('Failed to load guild settings:', err);
        }
    } catch (err) {
        logError('clientReady', err);
        console.error('Error during startup:', err);
    }

    poller.start();
    console.log(`Polling ${client.guilds.cache.size} guild(s) every ${BASE_POLL_MS / 1000}s via /api/bot/poll (with exponential backoff on errors)`);
});

client.on('guildCreate', async (guild) => {
    try {
        console.log(`Joined guild ${guild.id}`);
        await registerGuildCommands(guild.id);
        await fetchGuildSettings(guild.id);
        console.log(`Registered commands and loaded settings for guild ${guild.id}`);
    } catch (err) {
        logError(`guildCreate(${guild?.id})`, err);
        console.error(`Failed to set up new guild ${guild?.id}:`, err);
    }
});

process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection:', reason);
    logError('unhandledRejection', reason);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught exception:', err);
    logError('uncaughtException', err);
    process.exit(1);
});

if (DRY_RUN) {
    console.log('dry run ok');
    process.exit(0);
}

client.login(DISCORD_TOKEN).catch((err) => {
    logError('login', err);
    console.error('Discord login failed:', err);
    process.exit(1);
});
