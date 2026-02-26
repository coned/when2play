/**
 * Cloudflare Worker entry point.
 *
 * Routes:
 *   POST /interactions  — Discord interaction webhook (slash commands, buttons, modals)
 *   GET /register       — Manual trigger to register Discord commands
 *
 * Scheduled export:
 *   Cron every 15 min   — auto-close expired polls
 *
 * Command registration:
 *   Auto-registers once per isolate, or manually via GET /register
 */

import type { Env } from './env';
import { verifyDiscordRequest } from './discord/verify';
import { handleInteraction } from './discord/interactions/handler';
import { closeExpiredPolls } from './game/poll';
import { DiscordAPI } from './discord/api';
import { COMMANDS } from './discord/command-definitions';

let commandsRegistered = false;

async function registerGlobalCommands(env: Env): Promise<number> {
	const api = new DiscordAPI(env.DISCORD_BOT_TOKEN, env.DISCORD_APP_ID);
	const registered = await api.registerGlobalCommands(COMMANDS);
	return registered.length;
}

async function registerGuildCommands(env: Env): Promise<number> {
	if (!env.DISCORD_GUILD_ID) {
		throw new Error('DISCORD_GUILD_ID is not set');
	}
	const api = new DiscordAPI(env.DISCORD_BOT_TOKEN, env.DISCORD_APP_ID);
	const registered = await api.registerGuildCommands(COMMANDS, env.DISCORD_GUILD_ID);
	return registered.length;
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		// Optional manual trigger for command registration
		if (request.method === 'GET' && url.pathname === '/register') {
			try {
				const globalCount = await registerGlobalCommands(env);
				let msg = `Successfully registered ${globalCount} global commands.`;
				
				if (env.DISCORD_GUILD_ID) {
					const guildCount = await registerGuildCommands(env);
					msg += `\nSuccessfully registered ${guildCount} guild commands.`;
				}
				
				return new Response(msg, { status: 200 });
			} catch (e: any) {
				return new Response(`Failed to register commands: ${e.message}`, { status: 500 });
			}
		}

		// Auto-register commands once per isolate
		if (!commandsRegistered) {
			commandsRegistered = true; // Set immediately to prevent concurrent requests from triggering it multiple times
			ctx.waitUntil(
				(async () => {
					try {
						await registerGlobalCommands(env);
						if (env.DISCORD_GUILD_ID) {
							await registerGuildCommands(env);
						}
					} catch (e) {
						commandsRegistered = false; // Retry next time if it fails
						console.error('Failed to register commands', e);
					}
				})()
			);
		}

		if (request.method !== 'POST' || url.pathname !== '/interactions') {
			return new Response('Not Found', { status: 404 });
		}

		const { valid, body } = await verifyDiscordRequest(request, env.DISCORD_PUBLIC_KEY);
		if (!valid) {
			return new Response('Invalid signature', { status: 401 });
		}

		const interaction = JSON.parse(body);
		return handleInteraction(interaction, env, ctx);
	},

	async scheduled(_event: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
		const api = new DiscordAPI(env.DISCORD_BOT_TOKEN, env.DISCORD_APP_ID);
		await closeExpiredPolls(env.DB, api);
	},
} satisfies ExportedHandler<Env>;
