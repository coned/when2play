/**
 * Poll creation and lifecycle management.
 */

import { insertPoll, insertSlots, setPollMessageId, closePoll, getExpiredOpenPolls, getSlotsByPollId, getVotesByPollId, getSlotVoteCounts } from '../db/queries';
import { buildPollMessage } from './messages';
import { DiscordAPI } from '../discord/api';

export interface CreatePollInput {
	guildId: string;
	channelId: string;
	proposerId: string;
	proposerName: string;
	gameName: string;
	slotLabels: string[]; // e.g. ["Fri Feb 28 8:00pm", "Sat Mar 1 3:00pm"]
}

export const POLL_DURATION_SECONDS = 43200; // 12 hours

/**
 * Create a poll in D1, post the message to Discord, then store the message ID.
 * Returns the poll ID.
 */
export async function createPoll(db: D1Database, api: DiscordAPI, input: CreatePollInput): Promise<string> {
	const now = Math.floor(Date.now() / 1000);
	const pollId = crypto.randomUUID();

	await insertPoll(db, {
		id: pollId,
		guild_id: input.guildId,
		channel_id: input.channelId,
		proposer_id: input.proposerId,
		proposer_name: input.proposerName,
		game_name: input.gameName,
		created_at: now,
		expires_at: now + POLL_DURATION_SECONDS,
	});

	await insertSlots(db, pollId, input.slotLabels);

	// Fetch the newly created data to build the initial message
	const slots = await getSlotsByPollId(db, pollId);
	const poll = {
		id: pollId,
		guild_id: input.guildId,
		channel_id: input.channelId,
		message_id: null,
		proposer_id: input.proposerId,
		proposer_name: input.proposerName,
		game_name: input.gameName,
		created_at: now,
		expires_at: now + POLL_DURATION_SECONDS,
		closed_at: null,
		status: 'open' as const,
	};

	const messageBody = buildPollMessage(poll, slots, [], []);
	const message = await api.sendMessage(input.channelId, messageBody);

	await setPollMessageId(db, pollId, message.id);

	return pollId;
}

/**
 * Close a poll: mark it in D1 and update the Discord message to show final results
 * with all buttons disabled.
 */
export async function closePollAndUpdate(db: D1Database, api: DiscordAPI, pollId: string, channelId: string, messageId: string): Promise<void> {
	const now = Math.floor(Date.now() / 1000);
	await closePoll(db, pollId, now);

	const [slots, votes, slotCounts] = await Promise.all([
		getSlotsByPollId(db, pollId),
		getVotesByPollId(db, pollId),
		getSlotVoteCounts(db, pollId),
	]);

	const closedPollMock = { id: pollId, status: 'closed' as const, closed_at: now } as any;
	const messageBody = buildPollMessage({ ...closedPollMock, channel_id: channelId, message_id: messageId }, slots, votes, slotCounts);
	await api.editMessage(channelId, messageId, messageBody);
}

/**
 * Called by the cron scheduler: close all polls that have expired.
 */
export async function closeExpiredPolls(db: D1Database, api: DiscordAPI): Promise<void> {
	const now = Math.floor(Date.now() / 1000);
	const expired = await getExpiredOpenPolls(db, now);

	await Promise.allSettled(
		expired
			.filter((p) => p.message_id && p.channel_id)
			.map((p) => closePollAndUpdate(db, api, p.id, p.channel_id, p.message_id!))
	);
}

/**
 * Parse raw time slot text from the modal.
 * Splits on newlines/commas, trims each line, filters blanks.
 * Limits to 24 slots (Discord select menu max options is 25, we keep ≤24 to be safe).
 */
export function parseSlotLabels(raw: string): string[] {
	return raw
		.split(/[\n,]+/)
		.map((s) => s.trim())
		.filter(Boolean)
		.slice(0, 24);
}
