/**
 * Cloudflare Worker entry point.
 *
 * Two exports:
 *   fetch     — handles HTTP requests (Discord interaction webhook)
 *   scheduled — handles cron trigger (auto-close expired polls every 15 min)
 */

import type { Env } from './env';
import { verifyDiscordRequest } from './discord/verify';
import { handleInteraction } from './discord/interactions/handler';
import { closeExpiredPolls } from './game/poll';
import { DiscordAPI } from './discord/api';

export default {
	// ─── HTTP handler ────────────────────────────────────────────────────────────
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		// Only accept POST to /interactions
		if (request.method !== 'POST' || url.pathname !== '/interactions') {
			return new Response('Not Found', { status: 404 });
		}

		// 1. Verify the request is genuinely from Discord
		const { valid, body } = await verifyDiscordRequest(request, env.DISCORD_PUBLIC_KEY);
		if (!valid) {
			return new Response('Invalid signature', { status: 401 });
		}

		// 2. Parse and route the interaction
		const interaction = JSON.parse(body);
		return handleInteraction(interaction, env, ctx);
	},

	// ─── Cron handler (every 15 min) ─────────────────────────────────────────────
	async scheduled(_event: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
		const api = new DiscordAPI(env.DISCORD_BOT_TOKEN, env.DISCORD_APP_ID);
		await closeExpiredPolls(env.DB, api);
	},
} satisfies ExportedHandler<Env>;
