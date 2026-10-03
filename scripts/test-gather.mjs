#!/usr/bin/env node
/**
 * test-gather.mjs — End-to-end local test for the gather bell flow
 *
 * Usage:
 *   node scripts/test-gather.mjs [--message "CS2 anyone?"] [--anon] [--target <discord_id>]
 *
 * What it does:
 *   1. Creates an auth token via bot API (simulates Discord bot calling /api/auth/token)
 *   2. Redeems the token to get a session cookie (simulates user clicking link)
 *   3. Rings the gather bell with optional message / anonymous / targeted options
 *   4. Fetches pending pings as the bot
 *   5. Prints the formatted Discord message exactly as the bot would send it
 *   6. Marks the ping as delivered
 *
 * Requires the server to be running locally (make dev).
 * Bot auth fails closed: the server needs BOT_API_KEY (copy .dev.vars.example to
 * .dev.vars) and this script sends the same key. BOT_API_KEY and GUILD_ID default
 * to the value in .dev.vars and the first D1 binding in wrangler.jsonc.
 */

import fs from 'node:fs';

function readFileOrEmpty(file) {
	try {
		return fs.readFileSync(file, 'utf-8');
	} catch {
		return '';
	}
}

const API_URL = process.env.API_URL ?? 'http://localhost:8787';
const BOT_API_KEY = process.env.BOT_API_KEY || (readFileOrEmpty('.dev.vars').match(/^BOT_API_KEY=(.*)$/m)?.[1] ?? '').trim();
const GUILD_ID = process.env.GUILD_ID || (readFileOrEmpty('wrangler.jsonc').match(/"binding"\s*:\s*"DB_(\d+)"/)?.[1] ?? '');
if (!BOT_API_KEY) {
	console.error('BOT_API_KEY is not set. Run: cp .dev.vars.example .dev.vars (then restart make dev), or export BOT_API_KEY.');
	process.exit(1);
}
if (!GUILD_ID) {
	console.error('GUILD_ID is not set and no DB_<guild_id> binding was found in wrangler.jsonc. Export GUILD_ID.');
	process.exit(1);
}

// Parse CLI args
const args = process.argv.slice(2);
let message = null;
let isAnonymous = false;
let targetDiscordId = null;

for (let i = 0; i < args.length; i++) {
	if (args[i] === '--message' && args[i + 1]) message = args[++i];
	if (args[i] === '--anon') isAnonymous = true;
	if (args[i] === '--target' && args[i + 1]) targetDiscordId = args[++i];
}

const botHeaders = {
	'Content-Type': 'application/json',
	'X-Bot-Token': BOT_API_KEY,
	'X-Guild-Id': GUILD_ID,
};

// Unique fake Discord user for this test run
const discordId = String(Date.now()).slice(-10);
const username = `TestUser_${discordId.slice(-4)}`;

console.log(`\n=== when2play gather test ===`);
console.log(`API: ${API_URL} (guild ${GUILD_ID})`);
console.log(`Test user: ${username} (discord_id: ${discordId})\n`);

// ── Step 1: Create auth token ──────────────────────────────────────────────
process.stdout.write('1. Creating auth token... ');
const tokenRes = await fetch(`${API_URL}/api/auth/token`, {
	method: 'POST',
	headers: botHeaders,
	body: JSON.stringify({
		discord_id: discordId,
		discord_username: username,
		avatar_url: 'https://cdn.discordapp.com/embed/avatars/0.png',
	}),
});
const tokenJson = await tokenRes.json();
if (!tokenJson.ok) {
	console.error('FAILED:', tokenJson);
	process.exit(1);
}
const token = tokenJson.data.token;
console.log(`OK (token: ${token.slice(0, 8)}...)`);

// ── Step 2: Redeem token (get session cookie) ──────────────────────────────
process.stdout.write('2. Redeeming token (login)... ');
const loginRes = await fetch(`${API_URL}/api/auth/callback/${token}?guild=${GUILD_ID}`, {
	redirect: 'manual',
});
const setCookie = loginRes.headers.get('set-cookie');
if (!setCookie) {
	console.error('FAILED: no set-cookie header. Status:', loginRes.status);
	process.exit(1);
}
// Extract the session cookie value
// Cookie requests pick their guild from the guild_id cookie
const sessionCookie = `${setCookie.split(';')[0]}; guild_id=${GUILD_ID}`;
console.log(`OK (cookie: ${sessionCookie.slice(0, 30)}...)`);

// ── Step 3: Resolve target user ID (if --target given) ─────────────────────
let targetUserIds = undefined;
if (targetDiscordId) {
	process.stdout.write(`3. Looking up internal ID for Discord user ${targetDiscordId}... `);
	const usersRes = await fetch(`${API_URL}/api/users`, {
		headers: { Cookie: sessionCookie },
	});
	const usersJson = await usersRes.json();
	if (!usersJson.ok) {
		console.error('FAILED: could not fetch users:', usersJson);
		process.exit(1);
	}
	const match = usersJson.data.find((u) => u.discord_id === targetDiscordId || u.discord_username === targetDiscordId);
	if (!match) {
		console.warn(`  (no user found for "${targetDiscordId}", sending broadcast instead)`);
	} else {
		targetUserIds = [match.id];
		console.log(`OK (internal id: ${match.id})`);
	}
} else {
	console.log('3. No target specified — broadcast ping');
}

// ── Step 4: Ring the bell ──────────────────────────────────────────────────
process.stdout.write('4. Ringing gather bell... ');
const bellBody = { ...(message ? { message } : {}), is_anonymous: isAnonymous, ...(targetUserIds ? { target_user_ids: targetUserIds } : {}) };
const bellRes = await fetch(`${API_URL}/api/gather`, {
	method: 'POST',
	headers: { 'Content-Type': 'application/json', Cookie: sessionCookie },
	body: JSON.stringify(bellBody),
});
const bellJson = await bellRes.json();
if (!bellJson.ok) {
	console.error('FAILED:', bellJson);
	process.exit(1);
}
const pingId = bellJson.data?.id;
console.log(`OK (ping id: ${pingId ?? 'unknown'})`);

// ── Step 5: Fetch pending pings as bot ────────────────────────────────────
process.stdout.write('5. Fetching pending pings... ');
const pendingRes = await fetch(`${API_URL}/api/gather/pending`, { headers: botHeaders });
const pendingJson = await pendingRes.json();
if (!pendingJson.ok) {
	console.error('FAILED:', pendingJson);
	process.exit(1);
}
const pings = pendingJson.data;
console.log(`OK (${pings.length} pending)\n`);

// ── Step 6: Format and display each ping as Discord would ─────────────────
console.log('--- Discord message preview ---');
for (const ping of pings) {
	const sender = ping.is_anonymous ? 'Someone' : `<@${ping.sender_discord_id}>`;
	const msg = ping.message || 'Ready to play!';
	let text = `🔔 **Gather bell!** ${sender}: ${msg}`;

	if (ping.target_discord_ids && ping.target_discord_ids.length > 0) {
		const mentions = ping.target_discord_ids.map((id) => `<@${id}>`).join(' ');
		text += ` → ${mentions}`;
	}

	console.log(`  Ping ${ping.id.slice(0, 8)}:`);
	console.log(`  ${text}`);
	console.log(`  Fields: sender_discord_id=${ping.sender_discord_id}, sender_username=${ping.sender_username}, is_anonymous=${ping.is_anonymous}`);
	if (ping.target_discord_ids) console.log(`  target_discord_ids: ${JSON.stringify(ping.target_discord_ids)}`);
	console.log();

	// ── Step 7: Mark as delivered ──────────────────────────────────────────
	process.stdout.write(`6. Marking ping ${ping.id.slice(0, 8)} as delivered... `);
	const deliverRes = await fetch(`${API_URL}/api/gather/${ping.id}/delivered`, {
		method: 'PATCH',
		headers: botHeaders,
	});
	const deliverJson = await deliverRes.json();
	if (deliverJson.ok) {
		console.log('OK');
	} else {
		console.error('FAILED:', deliverJson);
	}
}

if (pings.length === 0) {
	console.log('  (no pings found — the bell ring may have been rate-limited)');
}

console.log('\n=== Done ===\n');
