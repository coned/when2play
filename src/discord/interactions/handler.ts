/**
 * Main interaction router.
 *
 * Discord sends all interactions (slash commands, button clicks, modal submits)
 * as POST requests to our Worker endpoint. This file routes them to the right handler.
 *
 * Interaction types:
 *   1 = PING           (Discord's health check — must respond with {type:1})
 *   2 = APPLICATION_COMMAND  (slash command)
 *   3 = MESSAGE_COMPONENT    (button or select menu click)
 *   5 = MODAL_SUBMIT         (modal form submitted)
 */

import type { Env } from '../../env';
import { DiscordAPI } from '../api';
import { handleCommand } from './commands';
import { handleComponent } from './components';
import { handleModal } from './modals';

// Interaction type constants
const InteractionType = {
	PING: 1,
	APPLICATION_COMMAND: 2,
	MESSAGE_COMPONENT: 3,
	MODAL_SUBMIT: 5,
} as const;

// Response type constants (what we send back to Discord)
export const ResponseType = {
	PONG: 1,
	CHANNEL_MESSAGE_WITH_SOURCE: 4,
	DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE: 5, // show loading spinner, then edit
	DEFERRED_UPDATE_MESSAGE: 6,               // acknowledge component, update later
	UPDATE_MESSAGE: 7,                        // update the original component message
	MODAL: 9,                                 // open a modal popup
} as const;

/** flags: 64 makes a response ephemeral (only visible to the clicking user) */
export const EPHEMERAL = 64;

export async function handleInteraction(interaction: any, env: Env, ctx: ExecutionContext): Promise<Response> {
	const api = new DiscordAPI(env.DISCORD_BOT_TOKEN, env.DISCORD_APP_ID);

	switch (interaction.type) {
		case InteractionType.PING:
			// Discord pings our endpoint to verify it's live — must respond with PONG
			return jsonResponse({ type: ResponseType.PONG });

		case InteractionType.APPLICATION_COMMAND:
			return handleCommand(interaction, env, api, ctx);

		case InteractionType.MESSAGE_COMPONENT:
			return handleComponent(interaction, env, api, ctx);

		case InteractionType.MODAL_SUBMIT:
			return handleModal(interaction, env, api, ctx);

		default:
			return new Response('Unknown interaction type', { status: 400 });
	}
}

export function jsonResponse(data: object, status = 200): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}
