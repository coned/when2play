/**
 * Slash command handlers.
 *
 * /game propose  — open a modal to create a gaming poll
 * /game close    — close your current open poll early
 * /game history  — show last N polls
 * /game stats    — show analytics (top games, most active players)
 */

import type { Env } from '../../env';
import type { DiscordAPI } from '../api';
import { ResponseType, EPHEMERAL, jsonResponse } from './handler';
import { getOpenPollByProposer, getRecentPolls, getVotesByPollId, getGameStats, getPlayerStats, getPollById, getSlotsByPollId, getSlotVoteCounts } from '../../db/queries';
import { closePollAndUpdate } from '../../game/poll';
import { buildResultsText } from '../../game/messages';

// Modal IDs (must match what modals.ts expects)
export const MODAL_PROPOSE = 'modal_propose';

export async function handleCommand(interaction: any, env: Env, api: DiscordAPI, ctx: ExecutionContext): Promise<Response> {
	const commandName: string = interaction.data.name;

	if (commandName !== 'game') {
		return jsonResponse({ type: ResponseType.CHANNEL_MESSAGE_WITH_SOURCE, data: { content: 'Unknown command.', flags: EPHEMERAL } });
	}

	const subcommand = interaction.data.options?.[0]?.name as string;

	switch (subcommand) {
		case 'propose':
			return handlePropose(interaction);
		case 'close':
			return handleClose(interaction, env, api, ctx);
		case 'history':
			return handleHistory(interaction, env);
		case 'stats':
			return handleStats(interaction, env);
		default:
			return jsonResponse({ type: ResponseType.CHANNEL_MESSAGE_WITH_SOURCE, data: { content: 'Unknown subcommand.', flags: EPHEMERAL } });
	}
}

// ─── /game propose ─────────────────────────────────────────────────────────────

function handlePropose(interaction: any): Response {
	// Open a modal popup — Discord shows this as a form the user fills in
	return jsonResponse({
		type: ResponseType.MODAL,
		data: {
			title: 'Propose a Gaming Session',
			custom_id: MODAL_PROPOSE,
			components: [
				{
					type: 1, // Action Row
					components: [
						{
							type: 4, // Text Input (short)
							custom_id: 'game_name',
							label: 'Game name',
							style: 1, // SHORT
							placeholder: 'e.g. Valorant',
							required: true,
							max_length: 100,
						},
					],
				},
				{
					type: 1,
					components: [
						{
							type: 4, // Text Input (paragraph)
							custom_id: 'time_slots',
							label: 'Time options (one per line, 30-min slots)',
							style: 2, // PARAGRAPH
							placeholder: 'Fri Feb 28 8:00pm\nSat Mar 1 3:00pm\nSun Mar 2 7:00pm',
							required: true,
							max_length: 1000,
						},
					],
				},
			],
		},
	});
}

// ─── /game close ──────────────────────────────────────────────────────────────

async function handleClose(interaction: any, env: Env, api: DiscordAPI, ctx: ExecutionContext): Promise<Response> {
	const userId: string = interaction.member?.user?.id ?? interaction.user?.id;
	const guildId: string = interaction.guild_id;

	// Defer so we have time for DB operations
	ctx.waitUntil(
		(async () => {
			const poll = await getOpenPollByProposer(env.DB, guildId, userId);
			if (!poll || !poll.message_id) {
				await api.editInteractionResponse(interaction.token, {
					content: "You don't have an active poll to close.",
					flags: EPHEMERAL,
				});
				return;
			}
			await closePollAndUpdate(env.DB, api, poll.id, poll.channel_id, poll.message_id);
			await api.editInteractionResponse(interaction.token, {
				content: `Poll for **${poll.game_name}** has been closed.`,
				flags: EPHEMERAL,
			});
		})()
	);

	return jsonResponse({
		type: ResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
		data: { flags: EPHEMERAL },
	});
}

// ─── /game history ─────────────────────────────────────────────────────────────

async function handleHistory(interaction: any, env: Env): Promise<Response> {
	const guildId: string = interaction.guild_id;
	const countOption = interaction.data.options?.[0]?.options?.find((o: any) => o.name === 'count');
	const limit = Math.min(countOption?.value ?? 5, 10);

	const polls = await getRecentPolls(env.DB, guildId, limit);

	if (polls.length === 0) {
		return jsonResponse({
			type: ResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
			data: { content: 'No polls found for this server yet.', flags: EPHEMERAL },
		});
	}

	const lines = await Promise.all(
		polls.map(async (p) => {
			const votes = await getVotesByPollId(env.DB, p.id);
			const yes = votes.filter((v) => v.vote_type === 'yes').length;
			const no = votes.filter((v) => v.vote_type === 'no').length;
			const statusEmoji = p.status === 'open' ? '🟢' : '⚫';
			const date = `<t:${p.created_at}:d>`;
			return `${statusEmoji} **${p.game_name}** by <@${p.proposer_id}> on ${date} — ✅${yes} ❌${no}`;
		})
	);

	return jsonResponse({
		type: ResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
		data: {
			content: `## 📜 Recent polls\n${lines.join('\n')}`,
			flags: EPHEMERAL,
			allowed_mentions: { parse: [] }, // Don't ping people in history
		},
	});
}

// ─── /game stats ──────────────────────────────────────────────────────────────

async function handleStats(interaction: any, env: Env): Promise<Response> {
	const guildId: string = interaction.guild_id;

	const [gameStats, playerStats] = await Promise.all([getGameStats(env.DB, guildId), getPlayerStats(env.DB, guildId)]);

	const gameLines =
		gameStats.length === 0
			? ['_No data yet_']
			: gameStats.map((g, i) => `${i + 1}. **${g.game_name}** — ${g.poll_count} polls · avg ✅${g.avg_yes} ❌${g.avg_no}`);

	const playerLines =
		playerStats.length === 0
			? ['_No data yet_']
			: playerStats.map((p, i) => `${i + 1}. **${p.voter_name}** — ${p.total_votes} votes (${p.yes_votes} yes)`);

	const content = [
		`## 📊 Server gaming stats`,
		``,
		`**Top games:**`,
		...gameLines,
		``,
		`**Most active players:**`,
		...playerLines,
	].join('\n');

	return jsonResponse({
		type: ResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
		data: { content, flags: EPHEMERAL },
	});
}
