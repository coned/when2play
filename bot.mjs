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
    new SlashCommandBuilder()
    .setName('when2play-admin')
    .setDescription('Get a one-time admin link for when2play (requires ADMINISTRATOR)'),
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
            // sender_discord_id is the numeric Discord ID (e.g. "123456789012345678")
            const sender = ping.is_anonymous ? 'Someone' : `<@${ping.sender_discord_id}>`;
            const msg = ping.message || 'Ready to play!';
            let text = `🔔 **Gather bell!** ${sender}: ${msg}`;

            // target_discord_ids are numeric Discord IDs resolved server-side
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