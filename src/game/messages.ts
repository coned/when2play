/**
 * Build Discord embeds and component rows for poll messages.
 *
 * Discord's message structure:
 *   - embeds: rich formatted cards with title, description, fields, footer
 *   - components: interactive rows of buttons / select menus (max 5 rows, 5 buttons per row)
 */

import type { Poll, PollSlot, Vote } from '../db/queries';

// ─── Discord component/embed type constants ────────────────────────────────────
const COMPONENT_ROW = 1;
const COMPONENT_BUTTON = 2;
const COMPONENT_STRING_SELECT = 3;

const BUTTON_PRIMARY = 1; // blurple
const BUTTON_SUCCESS = 3; // green
const BUTTON_DANGER = 4; // red
const BUTTON_SECONDARY = 2; // grey

const EMBED_COLOR_OPEN = 0x5865f2; // Discord blurple — poll is active
const EMBED_COLOR_CLOSED = 0x747f8d; // grey — poll closed

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Format a unix timestamp as a Discord dynamic timestamp (renders in user's timezone). */
function discordTimestamp(unix: number, style: 'R' | 'F' | 't' = 'R'): string {
	return `<t:${unix}:${style}>`;
}

/** A–Z labels for the first 25 slots (Discord select option limit). */
function slotLabel(index: number): string {
	return String.fromCharCode(65 + index); // A, B, C …
}

// ─── Poll embed ───────────────────────────────────────────────────────────────

interface VoteSummary {
	yesCount: number;
	noCount: number;
	slotCounts: Map<number, number>; // slot_id → yes votes
}

export function buildPollEmbed(poll: Poll, slots: PollSlot[], summary: VoteSummary) {
	const isOpen = poll.status === 'open';

	// Slot list with vote counts
	const slotLines = slots.map((slot, i) => {
		const count = summary.slotCounts.get(slot.id) ?? 0;
		const bar = count > 0 ? ` — **${count}** ✅` : '';
		return `**${slotLabel(i)})** ${slot.label}${bar}`;
	});

	const statusLine = isOpen
		? `Closes ${discordTimestamp(poll.expires_at, 'R')} (${discordTimestamp(poll.expires_at, 'F')})`
		: `Closed ${discordTimestamp(poll.closed_at!, 'R')}`;

	return {
		color: isOpen ? EMBED_COLOR_OPEN : EMBED_COLOR_CLOSED,
		title: `🎮 ${poll.game_name}`,
		description: slotLines.join('\n'),
		fields: [
			{
				name: 'Votes',
				value: `✅ **${summary.yesCount}** in  ·  ❌ **${summary.noCount}** out`,
				inline: true,
			},
			{
				name: 'Proposed by',
				value: `<@${poll.proposer_id}>`,
				inline: true,
			},
		],
		footer: { text: statusLine },
	};
}

// ─── Poll action buttons ───────────────────────────────────────────────────────

/**
 * The three buttons shown under every open poll.
 * custom_id encodes the action and poll ID so the interaction handler knows what to do.
 * Format: "action:pollId"
 */
export function buildPollActionRow(pollId: string, disabled = false) {
	return {
		type: COMPONENT_ROW,
		components: [
			{
				type: COMPONENT_BUTTON,
				style: BUTTON_SUCCESS,
				label: "I'm in! 🎮",
				custom_id: `vote_yes:${pollId}`,
				disabled,
			},
			{
				type: COMPONENT_BUTTON,
				style: BUTTON_DANGER,
				label: "Can't make it ❌",
				custom_id: `vote_no:${pollId}`,
				disabled,
			},
			{
				type: COMPONENT_BUTTON,
				style: BUTTON_SECONDARY,
				label: 'See Results 📊',
				custom_id: `view_results:${pollId}`,
				disabled,
			},
		],
	};
}

// ─── Time slot select menu (ephemeral, sent to the voter) ─────────────────────

/**
 * A multi-select dropdown of available time slots.
 * Sent as an ephemeral message so only the voter sees it.
 * min_values: 1 forces at least one selection; max_values: all slots.
 */
export function buildSlotSelectRow(pollId: string, slots: PollSlot[], preselected: number[] = []) {
	const options = slots.map((slot, i) => ({
		label: `${slotLabel(i)}) ${slot.label}`,
		value: String(slot.id),
		default: preselected.includes(slot.id),
	}));

	return {
		type: COMPONENT_ROW,
		components: [
			{
				type: COMPONENT_STRING_SELECT,
				custom_id: `select_slots:${pollId}`,
				placeholder: 'Pick your available time slots',
				min_values: 1,
				max_values: options.length,
				options,
			},
		],
	};
}

// ─── Full poll message body ───────────────────────────────────────────────────

/** The complete message body posted/edited in the channel. */
export function buildPollMessage(poll: Poll, slots: PollSlot[], votes: Vote[], slotCounts: Array<{ slot_id: number; count: number }>) {
	const yesCount = votes.filter((v) => v.vote_type === 'yes').length;
	const noCount = votes.filter((v) => v.vote_type === 'no').length;
	const slotCountMap = new Map(slotCounts.map((s) => [s.slot_id, s.count]));

	const embed = buildPollEmbed(poll, slots, { yesCount, noCount, slotCounts: slotCountMap });
	const actionRow = buildPollActionRow(poll.id, poll.status === 'closed');

	return { embeds: [embed], components: [actionRow] };
}

// ─── Results text (used in ephemeral "See Results" response) ──────────────────

export function buildResultsText(poll: Poll, slots: PollSlot[], votes: Vote[], slotCounts: Array<{ slot_id: number; count: number }>): string {
	const yesVoters = votes.filter((v) => v.vote_type === 'yes');
	const noVoters = votes.filter((v) => v.vote_type === 'no');
	const slotCountMap = new Map(slotCounts.map((s) => [s.slot_id, s.count]));

	const lines: string[] = [
		`## 📊 Results — ${poll.game_name}`,
		`✅ **In:** ${yesVoters.length}  ·  ❌ **Out:** ${noVoters.length}`,
		``,
		`**Time slot availability:**`,
		...slots.map((slot, i) => {
			const count = slotCountMap.get(slot.id) ?? 0;
			const pct = yesVoters.length > 0 ? Math.round((count / yesVoters.length) * 100) : 0;
			const bar = '█'.repeat(Math.round(pct / 10)) + '░'.repeat(10 - Math.round(pct / 10));
			return `**${slotLabel(i)})** ${slot.label}\n\`${bar}\` ${count}/${yesVoters.length} (${pct}%)`;
		}),
	];

	if (yesVoters.length > 0) {
		lines.push(``, `**Who's in:** ${yesVoters.map((v) => `<@${v.voter_id}>`).join(', ')}`);
	}
	if (noVoters.length > 0) {
		lines.push(`**Can't make it:** ${noVoters.map((v) => `<@${v.voter_id}>`).join(', ')}`);
	}

	return lines.join('\n');
}
