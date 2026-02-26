/**
 * Message component handlers — buttons and select menus.
 *
 * custom_id format: "action:pollId"
 *   vote_yes:pollId     — "I'm in!" button clicked
 *   vote_no:pollId      — "Can't make it" button clicked
 *   view_results:pollId — "See Results" button clicked
 *   select_slots:pollId — time slot select menu submitted
 */

import type { Env } from '../../env';
import type { DiscordAPI } from '../api';
import { ResponseType, EPHEMERAL, jsonResponse } from './handler';
import { getPollById, getSlotsByPollId, getVoteByVoter, getVotesByPollId, getSlotVoteCounts } from '../../db/queries';
import { recordVote } from '../../game/vote';
import { buildSlotSelectRow, buildResultsText } from '../../game/messages';

export async function handleComponent(interaction: any, env: Env, api: DiscordAPI, ctx: ExecutionContext): Promise<Response> {
	const customId: string = interaction.data.custom_id;
	const [action, pollId] = customId.split(':');

	switch (action) {
		case 'vote_yes':
			return handleVoteYes(interaction, pollId, env, api, ctx);
		case 'vote_no':
			return handleVoteNo(interaction, pollId, env, api, ctx);
		case 'view_results':
			return handleViewResults(interaction, pollId, env);
		case 'select_slots':
			return handleSelectSlots(interaction, pollId, env, api, ctx);
		default:
			return jsonResponse({ type: ResponseType.CHANNEL_MESSAGE_WITH_SOURCE, data: { content: 'Unknown action.', flags: EPHEMERAL } });
	}
}

// ─── "I'm in!" button ─────────────────────────────────────────────────────────

async function handleVoteYes(interaction: any, pollId: string, env: Env, api: DiscordAPI, ctx: ExecutionContext): Promise<Response> {
	const poll = await getPollById(env.DB, pollId);
	if (!poll || poll.status === 'closed') {
		return jsonResponse({
			type: ResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
			data: { content: 'This poll is no longer active.', flags: EPHEMERAL },
		});
	}

	const slots = await getSlotsByPollId(env.DB, pollId);
	const voterId: string = interaction.member?.user?.id ?? interaction.user?.id;

	// Find any slots this voter previously selected
	const existingVote = await getVoteByVoter(env.DB, pollId, voterId);
	const preselectedIds = existingVote?.vote_type === 'yes'
		? [] // We'd need a separate query for this; keep it simple
		: [];

	// Send ephemeral message with the slot picker
	return jsonResponse({
		type: ResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
		data: {
			content: `**Pick your available time slots for ${poll.game_name}:**`,
			components: [buildSlotSelectRow(pollId, slots, preselectedIds)],
			flags: EPHEMERAL,
		},
	});
}

// ─── "Can't make it" button ───────────────────────────────────────────────────

async function handleVoteNo(interaction: any, pollId: string, env: Env, api: DiscordAPI, ctx: ExecutionContext): Promise<Response> {
	const poll = await getPollById(env.DB, pollId);
	if (!poll || poll.status === 'closed') {
		return jsonResponse({
			type: ResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
			data: { content: 'This poll is no longer active.', flags: EPHEMERAL },
		});
	}

	const userId: string = interaction.member?.user?.id ?? interaction.user?.id;
	const userName: string = interaction.member?.user?.global_name ?? interaction.member?.user?.username ?? interaction.user?.global_name ?? interaction.user?.username ?? 'Unknown';

	// Record the no vote in the background and update the poll message
	ctx.waitUntil(recordVote(env.DB, api, pollId, userId, userName, 'no', []));

	return jsonResponse({
		type: ResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
		data: { content: `Got it — you're out for **${poll.game_name}**. Vote updated!`, flags: EPHEMERAL },
	});
}

// ─── "See Results" button ─────────────────────────────────────────────────────

async function handleViewResults(interaction: any, pollId: string, env: Env): Promise<Response> {
	const poll = await getPollById(env.DB, pollId);
	if (!poll) {
		return jsonResponse({
			type: ResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
			data: { content: 'Poll not found.', flags: EPHEMERAL },
		});
	}

	const [slots, votes, slotCounts] = await Promise.all([
		getSlotsByPollId(env.DB, pollId),
		getVotesByPollId(env.DB, pollId),
		getSlotVoteCounts(env.DB, pollId),
	]);

	const resultsText = buildResultsText(poll, slots, votes, slotCounts);

	return jsonResponse({
		type: ResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
		data: {
			content: resultsText,
			flags: EPHEMERAL,
			allowed_mentions: { parse: [] },
		},
	});
}

// ─── Time slot select menu submitted ─────────────────────────────────────────

async function handleSelectSlots(interaction: any, pollId: string, env: Env, api: DiscordAPI, ctx: ExecutionContext): Promise<Response> {
	const poll = await getPollById(env.DB, pollId);
	if (!poll || poll.status === 'closed') {
		return jsonResponse({
			type: ResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
			data: { content: 'This poll is no longer active.', flags: EPHEMERAL },
		});
	}

	const userId: string = interaction.member?.user?.id ?? interaction.user?.id;
	const userName: string = interaction.member?.user?.global_name ?? interaction.member?.user?.username ?? interaction.user?.global_name ?? interaction.user?.username ?? 'Unknown';

	// Selected slot IDs come as string values from the select menu
	const selectedSlotIds: number[] = (interaction.data.values as string[]).map(Number);

	// Record vote in background, update main poll message
	ctx.waitUntil(recordVote(env.DB, api, pollId, userId, userName, 'yes', selectedSlotIds));

	const count = selectedSlotIds.length;
	return jsonResponse({
		type: ResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
		data: {
			content: `You're in for **${poll.game_name}**! Selected ${count} time slot${count !== 1 ? 's' : ''}. ✅`,
			flags: EPHEMERAL,
		},
	});
}
