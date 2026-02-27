import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, AttachmentBuilder } from 'discord.js';

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const API_URL = process.env.WHEN2PLAY_API_URL;
const BOT_API_KEY = process.env.BOT_API_KEY;
const GAMING_CHANNEL_ID = process.env.GAMING_CHANNEL_ID;
const GUILD_ID = process.env.GUILD_ID;
const BASE_POLL_MS = 15_000;
const MAX_POLL_MS = 2 * 60 * 1000;
let consecutiveErrors = 0;

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
    new SlashCommandBuilder()
        .setName('when2play-admin')
        .setDescription('Get a one-time admin link for when2play (requires ADMINISTRATOR)'),
    new SlashCommandBuilder()
        .setName('call')
        .setDescription('Call everyone to play!')
        .addStringOption(o => o.setName('when').setDescription('Now or later?')
            .addChoices({ name: 'Now', value: 'now' }, { name: 'Later', value: 'later' })
            .setRequired(false)),
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
        .setName('judge')
        .setDescription('Ask the judge')
        .addSubcommand(sub => sub.setName('time').setDescription('Suggest best time slots'))
        .addSubcommand(sub => sub.setName('avail').setDescription('Nudge someone to set availability')
            .addUserOption(o => o.setName('user').setDescription('Who to nudge').setRequired(true))),
    new SlashCommandBuilder()
        .setName('brb')
        .setDescription('Be right back, joining shortly')
        .addStringOption(o => o.setName('message').setDescription('Optional message').setRequired(false)),
    new SlashCommandBuilder()
        .setName('where')
        .setDescription("Where are you? You didn't show up!")
        .addUserOption(o => o.setName('user').setDescription('Who to ask').setRequired(true)),
    new SlashCommandBuilder()
        .setName('tree')
        .setDescription("Post today's gaming tree diagram to the channel"),
    new SlashCommandBuilder()
        .setName('url')
        .setDescription('Get the when2play website URL'),
    new SlashCommandBuilder()
        .setName('ranking')
        .setDescription('Post the current game rankings to the channel'),
];

async function registerCommands() {
    const rest = new REST().setToken(DISCORD_TOKEN);
    if (GUILD_ID) {
        await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), {
            body: commands.map(c => c.toJSON()),
        });
        console.log(`Slash commands registered (guild: ${GUILD_ID}).`);
    } else {
        await rest.put(Routes.applicationCommands(client.user.id), {
            body: commands.map(c => c.toJSON()),
        });
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

// --- Helper: resolve Discord user ID to when2play user ID via auth token flow ---
async function ensureUser(discordUser) {
    const res = await fetch(`${API_URL}/api/auth/token`, {
        method: 'POST',
        headers: botHeaders,
        body: JSON.stringify({
            discord_id: discordUser.id,
            discord_username: discordUser.displayName ?? discordUser.username,
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
            'Cookie': `session=${sessionId}`,
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

// --- /ranking handler ---
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'ranking') return;
    await interaction.deferReply({ flags: 64 });

    try {
        const authData = await ensureUser(interaction.user);
        if (!authData) {
            await interaction.editReply('Could not authenticate. Try `/play` first.');
            return;
        }
        const { session } = authData;

        const json = await apiCallWithSession(session.session_id, '/api/games/ranking');
        if (!json.ok || !json.data || json.data.length === 0) {
            await interaction.editReply('No game rankings yet. Vote on games first!');
            return;
        }

        let text = '🎮 **Game Rankings:**\n';
        for (let i = 0; i < Math.min(json.data.length, 10); i++) {
            const g = json.data[i];
            text += `#${i + 1} ${g.name} — ${g.total_score} pts\n`;
        }

        const channel = await client.channels.fetch(GAMING_CHANNEL_ID);
        if (channel?.isTextBased()) {
            await channel.send(text);
        }
        await interaction.editReply('Rankings posted to the channel!');
    } catch (err) {
        console.error('Error handling /ranking:', err);
        await interaction.editReply('Something went wrong.');
    }
});

// --- Rally command handlers ---
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const { commandName } = interaction;

    // Rally commands
    if (!['call', 'in', 'out', 'ping', 'judge', 'brb', 'where', 'tree'].includes(commandName)) return;

    await interaction.deferReply({ flags: 64 });

    try {
        // Ensure the user exists and get a session
        const authData = await ensureUser(interaction.user);
        if (!authData) {
            await interaction.editReply('Could not authenticate. Try `/play` first to set up your account.');
            return;
        }
        const { session } = authData;

        if (commandName === 'call') {
            const timing = interaction.options.getString('when') ?? 'now';
            const json = await apiCallWithSession(session.session_id, '/api/rally/call', {
                method: 'POST',
                body: JSON.stringify({ timing }),
            });
            if (!json.ok) {
                await interaction.editReply(`Failed: ${json.error.message}`);
                return;
            }
            await interaction.editReply(`Rally started! (${timing})`);
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

        else if (commandName === 'judge') {
            const sub = interaction.options.getSubcommand();
            if (sub === 'time') {
                const json = await apiCallWithSession(session.session_id, '/api/rally/judge/time', {
                    method: 'POST',
                });
                if (!json.ok) {
                    await interaction.editReply(`Failed: ${json.error.message}`);
                    return;
                }
                await interaction.editReply('Judge is computing best time slots...');
            } else if (sub === 'avail') {
                const targetDiscordUser = interaction.options.getUser('user', true);
                const targetAuth = await ensureUser(targetDiscordUser);
                if (!targetAuth) {
                    await interaction.editReply('Could not find that user.');
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
                await interaction.editReply(`Nudged ${targetDiscordUser.displayName} to set availability.`);
            }
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

        else if (commandName === 'tree') {
            const res = await fetch(`${API_URL}/api/rally/active`, {
                headers: { ...botHeaders, 'Cookie': `session=${session.session_id}` },
            });
            const json = await res.json();
            if (!json.ok || !json.data.rally) {
                await interaction.editReply('No active rally today. Use `/call` to start one!');
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
            const channel = await client.channels.fetch(GAMING_CHANNEL_ID);
            if (channel?.isTextBased()) {
                await channel.send(summary);
            }
            await interaction.editReply('Tree posted to the channel!');
        }

    } catch (err) {
        console.error(`Error handling /${commandName}:`, err);
        await interaction.editReply('Something went wrong. Is the when2play server running?');
    }
});

// --- Rally action polling ---
async function pollRallyActions() {
    try {
        const res = await fetch(`${API_URL}/api/rally/pending`, { headers: botHeaders });
        const json = await res.json();
        if (!json.ok || json.data.length === 0) return;

        const channel = await client.channels.fetch(GAMING_CHANNEL_ID);
        if (!channel?.isTextBased()) return;

        for (const action of json.data) {
            // Use bold plaintext name instead of @mention to avoid pinging the sender
            const actor = `**${action.actor_username}**`;
            let text = '';

            switch (action.action_type) {
                case 'call':
                    text = `📢 ${actor}: let's play! (${action.message || 'now'})`;
                    break;
                case 'in':
                    text = `✅ ${actor} is in!${action.message ? ` ${action.message}` : ''}`;
                    break;
                case 'out':
                    text = `❌ ${actor} is out.${action.message ? ` "${action.message}"` : ''}`;
                    break;
                case 'ping': {
                    const targets = action.target_discord_ids?.map(id => `<@${id}>`).join(', ') ?? 'someone';
                    text = `👋 ${actor} → ${targets}: ${action.message || 'come play!'}`;
                    break;
                }
                case 'judge_time': {
                    const meta = action.metadata;
                    if (meta?.windows?.length > 0) {
                        const windowStrs = meta.windows.slice(0, 3).map(w =>
                            `${w.start}-${w.end} (${w.user_count} ${w.user_count === 1 ? 'person' : 'people'})`
                        );
                        text = `🤖 Judge says: Best windows — ${windowStrs.join(', ')}`;
                    } else {
                        text = `🤖 Judge says: No overlapping availability found. Set your times!`;
                    }
                    break;
                }
                case 'judge_avail': {
                    const targets = action.target_discord_ids?.map(id => `<@${id}>`).join(', ') ?? 'someone';
                    text = `🤖 Judge → ${targets}: Please set your availability!`;
                    break;
                }
                case 'brb':
                    text = `⏳ ${actor}: brb${action.message ? ', ' + action.message : ''}`;
                    break;
                case 'where': {
                    const targets = action.target_discord_ids?.map(id => `<@${id}>`).join(', ') ?? 'someone';
                    text = `❓ ${actor} → ${targets}: where are you?`;
                    break;
                }
                default:
                    text = `${actor}: ${action.action_type}`;
            }

            if (text) await channel.send(text);

            await fetch(`${API_URL}/api/rally/${action.id}/delivered`, {
                method: 'PATCH',
                headers: botHeaders,
            });
        }
    } catch (err) {
        console.error('Error polling rally actions:', err);
    }
}

// --- Tree share polling ---
async function pollTreeShares() {
    try {
        const res = await fetch(`${API_URL}/api/rally/tree/share/pending`, { headers: botHeaders });
        const json = await res.json();
        if (!json.ok || json.data.length === 0) return;

        const channel = await client.channels.fetch(GAMING_CHANNEL_ID);
        if (!channel?.isTextBased()) return;

        for (const share of json.data) {
            if (share.image_data) {
                const buffer = Buffer.from(share.image_data, 'base64');
                const attachment = new AttachmentBuilder(buffer, { name: `gaming-tree-${share.day_key}.png` });
                await channel.send({ content: `📊 **Gaming Tree** — ${share.day_key}`, files: [attachment] });
            }

            await fetch(`${API_URL}/api/rally/tree/share/${share.id}/delivered`, {
                method: 'PATCH',
                headers: botHeaders,
            });
        }
    } catch (err) {
        console.error('Error polling tree shares:', err);
    }
}

// Gather ping polling
async function pollGatherPings() {
    try {
        const res = await fetch(`${API_URL}/api/gather/pending`, { headers: botHeaders });
        const json = await res.json();
        if (!json.ok || json.data.length === 0) {
            consecutiveErrors = 0;
            return;
        }

        const channel = await client.channels.fetch(GAMING_CHANNEL_ID);
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

            await channel.send(text);
            await fetch(`${API_URL}/api/gather/${ping.id}/delivered`, {
                method: 'PATCH',
                headers: botHeaders,
            });
        }
        consecutiveErrors = 0;
    } catch (err) {
        consecutiveErrors++;
        console.error(`Error polling gather pings (consecutive errors: ${consecutiveErrors}):`, err);
    }
}

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

client.once('ready', async () => {
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
