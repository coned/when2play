/**
 * Vote recording logic.
 * Handles upsert so a user can change their vote (e.g. from yes to no or update their slots).
 */

import { upsertVote, setVoteSlots, getSlotsByPollId, getVotesByPollId, getSlotVoteCounts, getPollById } from '../db/queries';
import { buildPollMessage } from './messages';
import { DiscordAPI } from '../discord/api';

/**
 * Record a yes or no vote, then refresh the poll message in the channel.
 * For 'no' votes, slotIds is empty.
 * For 'yes' votes, slotIds contains the slot IDs the voter selected.
 * Returns the updated vote display text so we can send an ephemeral confirmation.
 */
export async function recordVote(
	db: D1Database,
	api: DiscordAPI,
	pollId: string,
	voterId: string,
	voterName: string,
	voteType: 'yes' | 'no',
	slotIds: number[]
): Promise<void> {
	const now = Math.floor(Date.now() / 1000);

	const voteId = await upsertVote(db, pollId, voterId, voterName, voteType, now);

	if (voteType === 'yes' && slotIds.length > 0) {
		await setVoteSlots(db, voteId, slotIds);
	} else if (voteType === 'no') {
		// Clear any previously selected slots
		await setVoteSlots(db, voteId, []);
	}

	// Refresh the poll message in the channel
	const poll = await getPollById(db, pollId);
	if (!poll || !poll.message_id) return;

	const [slots, votes, slotCounts] = await Promise.all([
		getSlotsByPollId(db, pollId),
		getVotesByPollId(db, pollId),
		getSlotVoteCounts(db, pollId),
	]);

	const messageBody = buildPollMessage(poll, slots, votes, slotCounts);
	await api.editMessage(poll.channel_id, poll.message_id, messageBody);
}
