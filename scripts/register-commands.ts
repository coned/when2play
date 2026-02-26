/**
 * Registers slash commands with Discord.
 * Safe to run on every deploy — PUT does a full overwrite, so it's idempotent.
 *
 * Local usage (reads .dev.vars automatically):
 *   npm run register
 *
 * CI usage (env vars injected by GitHub Actions secrets):
 *   DISCORD_APP_ID=... DISCORD_BOT_TOKEN=... npx tsx scripts/register-commands.ts
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { COMMANDS } from '../src/discord/command-definitions';

// Load .dev.vars so you never need to manually export env vars locally.
function loadDevVars() {
	try {
		const content = readFileSync(join(process.cwd(), '.dev.vars'), 'utf-8');
		for (const line of content.split('\n')) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith('#')) continue;
			const eq = trimmed.indexOf('=');
			if (eq === -1) continue;
			const key = trimmed.slice(0, eq).trim();
			const value = trimmed.slice(eq + 1).trim();
			if (!process.env[key]) process.env[key] = value;
		}
	} catch {
		// .dev.vars doesn't exist (e.g. in CI) — fall through to env vars
	}
}

loadDevVars();

const APP_ID = process.env.DISCORD_APP_ID;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;

if (!APP_ID || !BOT_TOKEN) {
	console.error('Missing DISCORD_APP_ID or DISCORD_BOT_TOKEN.');
	console.error('Add them to .dev.vars for local use, or set them as environment variables.');
	process.exit(1);
}

(async () => {
	const response = await fetch(`https://discord.com/api/v10/applications/${APP_ID}/commands`, {
		method: 'PUT',
		headers: {
			Authorization: `Bot ${BOT_TOKEN}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify(COMMANDS),
	});

	if (!response.ok) {
		console.error('Failed to register commands:', response.status, await response.text());
		process.exit(1);
	}

	const registered = (await response.json()) as any[];
	console.log(`✅ Registered ${registered.length} command(s):`);
	for (const cmd of registered) {
		console.log(`  /${cmd.name} (id: ${cmd.id})`);
	}
})();
