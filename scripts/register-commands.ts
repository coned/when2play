/**
 * One-time script to register slash commands with Discord.
 * Run after deploy or any time command definitions change:
 *
 *   npx tsx scripts/register-commands.ts
 *
 * Requires env vars (copy from wrangler.jsonc vars + your bot token):
 *   DISCORD_APP_ID, DISCORD_BOT_TOKEN
 * Set them in .dev.vars or export in your shell.
 */

const APP_ID = process.env.DISCORD_APP_ID;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

if (!APP_ID || !BOT_TOKEN) {
	console.error('Missing DISCORD_APP_ID or DISCORD_BOT_TOKEN');
	process.exit(1);
}

const commands = [
	{
		name: 'game',
		description: 'Gaming session polls',
		options: [
			{
				type: 1, // SUB_COMMAND
				name: 'propose',
				description: 'Propose a gaming session and let people vote on time slots',
			},
			{
				type: 1,
				name: 'close',
				description: 'Close your currently active poll early',
			},
			{
				type: 1,
				name: 'history',
				description: 'Show recent gaming polls',
				options: [
					{
						type: 4, // INTEGER
						name: 'count',
						description: 'Number of polls to show (default 5, max 10)',
						required: false,
						min_value: 1,
						max_value: 10,
					},
				],
			},
			{
				type: 1,
				name: 'stats',
				description: 'Show gaming analytics (top games, most active players)',
			},
		],
	},
];

const response = await fetch(`https://discord.com/api/v10/applications/${APP_ID}/commands`, {
	method: 'PUT', // Bulk overwrite — replaces all existing global commands
	headers: {
		Authorization: `Bot ${BOT_TOKEN}`,
		'Content-Type': 'application/json',
	},
	body: JSON.stringify(commands),
});

if (!response.ok) {
	console.error('Failed to register commands:', response.status, await response.text());
	process.exit(1);
}

const registered = await response.json();
console.log(`✅ Registered ${(registered as any[]).length} command(s):`);
for (const cmd of registered as any[]) {
	console.log(`  /${cmd.name} (id: ${cmd.id})`);
}
