/**
 * Modal submit handler.
 * Currently handles only MODAL_PROPOSE — the "Propose a Gaming Session" form.
 */

import type { Env } from '../../env';
import type { DiscordAPI } from '../api';
import { MODAL_PROPOSE } from './commands';
import { ResponseType, EPHEMERAL, jsonResponse } from './handler';
import { createPoll, parseSlotLabels } from '../../game/poll';

export async function handleModal(interaction: any, env: Env, api: DiscordAPI, ctx: ExecutionContext): Promise<Response> {
	const modalId: string = interaction.data.custom_id;

	if (modalId === MODAL_PROPOSE) {
		return handlePropose(interaction, env, api, ctx);
	}

	return jsonResponse({
		type: ResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
		data: { content: 'Unknown form.', flags: EPHEMERAL },
	});
}

async function handlePropose(interaction: any, env: Env, api: DiscordAPI, ctx: ExecutionContext): Promise<Response> {
	// Extract field values from the modal submission
	const components: any[] = interaction.data.components;
	const getValue = (customId: string) =>
		components.flatMap((row: any) => row.components).find((c: any) => c.custom_id === customId)?.value ?? '';

	const gameName = getValue('game_name').trim();
	const rawSlots = getValue('time_slots');
	const slotLabels = parseSlotLabels(rawSlots);

	if (!gameName) {
		return jsonResponse({
			type: ResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
			data: { content: 'Game name cannot be empty.', flags: EPHEMERAL },
		});
	}

	if (slotLabels.length === 0) {
		return jsonResponse({
			type: ResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
			data: { content: 'Please provide at least one time option.', flags: EPHEMERAL },
		});
	}

	const userId: string = interaction.member?.user?.id ?? interaction.user?.id;
	const userName: string = interaction.member?.user?.global_name ?? interaction.member?.user?.username ?? interaction.user?.global_name ?? interaction.user?.username ?? 'Unknown';
	const guildId: string = interaction.guild_id;
	const channelId: string = interaction.channel_id ?? interaction.channel?.id;

	// Defer — creating poll + sending Discord message may take >1s
	ctx.waitUntil(
		(async () => {
			try {
				await createPoll(env.DB, api, {
					guildId,
					channelId,
					proposerId: userId,
					proposerName: userName,
					gameName,
					slotLabels,
				});
				// Respond to the interaction (invisible to everyone except the proposer)
				await api.editInteractionResponse(interaction.token, {
					content: `✅ Poll for **${gameName}** posted!`,
					flags: EPHEMERAL,
				});
			} catch (err) {
				console.error('createPoll error', err);
				await api.editInteractionResponse(interaction.token, {
					content: '❌ Something went wrong creating the poll. Please try again.',
					flags: EPHEMERAL,
				});
			}
		})()
	);

	return jsonResponse({
		type: ResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
		data: { flags: EPHEMERAL },
	});
}
