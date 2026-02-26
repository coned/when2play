/**
 * Cloudflare Worker entry point.
 *
 * Routes:
 *   POST /interactions  — Discord interaction webhook (slash commands, buttons, modals)
 *   GET  /register      — Register/update Discord slash commands (one-time setup)
 *
 * Scheduled export:
 *   Cron every 15 min   — auto-close expired polls
 */

import type { Env } from './env';
import { verifyDiscordRequest } from './discord/verify';
import { handleInteraction } from './discord/interactions/handler';
import { closeExpiredPolls } from './game/poll';
import { DiscordAPI } from './discord/api';
import { COMMANDS } from './discord/command-definitions';

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		// ── GET /register ────────────────────────────────────────────────────────
		// Registers (or re-registers) the bot's slash commands with Discord.
		// Protected by the bot token — only you know it.
		// Visit once after every deploy where commands change:
		//   curl -H "Authorization: Bearer <BOT_TOKEN>" https://your-worker.workers.dev/register
		if (request.method === 'GET' && url.pathname === '/register') {
			if (request.headers.get('Authorization') !== `Bearer ${env.DISCORD_BOT_TOKEN}`) {
				return new Response('Unauthorized', { status: 401 });
			}

			const res = await fetch(`https://discord.com/api/v10/applications/${env.DISCORD_APP_ID}/commands`, {
				method: 'PUT',
				headers: {
					Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(COMMANDS),
			});

			const data = await res.json() as any[];
			if (!res.ok) {
				return Response.json({ error: data }, { status: 500 });
			}
			return Response.json({ registered: data.map((c: any) => `/${c.name}`) });
		}

		// ── POST /interactions ────────────────────────────────────────────────────
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

	// ── Cron (every 15 min) ──────────────────────────────────────────────────────
	async scheduled(_event: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
		const api = new DiscordAPI(env.DISCORD_BOT_TOKEN, env.DISCORD_APP_ID);
		await closeExpiredPolls(env.DB, api);
	},
} satisfies ExportedHandler<Env>;
