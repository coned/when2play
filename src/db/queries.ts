/**
 * All D1 database query functions.
 * Each function is typed and uses prepared statements (?-placeholders) to prevent SQL injection.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Poll {
	id: string;
	guild_id: string;
	channel_id: string;
	message_id: string | null;
	proposer_id: string;
	proposer_name: string;
	game_name: string;
	created_at: number;
	expires_at: number;
	closed_at: number | null;
	status: 'open' | 'closed';
}

export interface PollSlot {
	id: number;
	poll_id: string;
	label: string;
	slot_order: number;
}

export interface Vote {
	id: number;
	poll_id: string;
	voter_id: string;
	voter_name: string;
	vote_type: 'yes' | 'no';
	voted_at: number;
}

// ─── Poll queries ──────────────────────────────────────────────────────────────

export async function insertPoll(db: D1Database, poll: Omit<Poll, 'message_id' | 'closed_at' | 'status'>): Promise<void> {
	await db
		.prepare(
			`INSERT INTO polls (id, guild_id, channel_id, proposer_id, proposer_name, game_name, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.bind(poll.id, poll.guild_id, poll.channel_id, poll.proposer_id, poll.proposer_name, poll.game_name, poll.created_at, poll.expires_at)
		.run();
}

export async function setPollMessageId(db: D1Database, pollId: string, messageId: string): Promise<void> {
	await db.prepare(`UPDATE polls SET message_id = ? WHERE id = ?`).bind(messageId, pollId).run();
}

export async function getPollById(db: D1Database, pollId: string): Promise<Poll | null> {
	return db.prepare(`SELECT * FROM polls WHERE id = ?`).bind(pollId).first<Poll>();
}

/** Find the latest open poll in a guild created by a specific user. */
export async function getOpenPollByProposer(db: D1Database, guildId: string, proposerId: string): Promise<Poll | null> {
	return db
		.prepare(`SELECT * FROM polls WHERE guild_id = ? AND proposer_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 1`)
		.bind(guildId, proposerId)
		.first<Poll>();
}

export async function closePoll(db: D1Database, pollId: string, closedAt: number): Promise<void> {
	await db.prepare(`UPDATE polls SET status = 'closed', closed_at = ? WHERE id = ?`).bind(closedAt, pollId).run();
}

/** Returns all polls that have expired but are still marked open. */
export async function getExpiredOpenPolls(db: D1Database, now: number): Promise<Poll[]> {
	const result = await db.prepare(`SELECT * FROM polls WHERE status = 'open' AND expires_at <= ?`).bind(now).all<Poll>();
	return result.results;
}

/** Last N polls for a guild, newest first. */
export async function getRecentPolls(db: D1Database, guildId: string, limit: number): Promise<Poll[]> {
	const result = await db
		.prepare(`SELECT * FROM polls WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?`)
		.bind(guildId, limit)
		.all<Poll>();
	return result.results;
}

// ─── Slot queries ─────────────────────────────────────────────────────────────

export async function insertSlots(db: D1Database, pollId: string, labels: string[]): Promise<void> {
	// Batch insert all slots in one round-trip
	const statements = labels.map((label, i) =>
		db.prepare(`INSERT INTO poll_slots (poll_id, label, slot_order) VALUES (?, ?, ?)`).bind(pollId, label, i)
	);
	await db.batch(statements);
}

export async function getSlotsByPollId(db: D1Database, pollId: string): Promise<PollSlot[]> {
	const result = await db.prepare(`SELECT * FROM poll_slots WHERE poll_id = ? ORDER BY slot_order`).bind(pollId).all<PollSlot>();
	return result.results;
}

// ─── Vote queries ─────────────────────────────────────────────────────────────

export async function upsertVote(
	db: D1Database,
	pollId: string,
	voterId: string,
	voterName: string,
	voteType: 'yes' | 'no',
	votedAt: number
): Promise<number> {
	// Insert or replace (UNIQUE constraint on poll_id + voter_id triggers replace)
	const result = await db
		.prepare(
			`INSERT INTO votes (poll_id, voter_id, voter_name, vote_type, voted_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(poll_id, voter_id) DO UPDATE SET vote_type = excluded.vote_type, voter_name = excluded.voter_name, voted_at = excluded.voted_at`
		)
		.bind(pollId, voterId, voterName, voteType, votedAt)
		.run();

	// Get the vote id (newly inserted or existing)
	const row = await db.prepare(`SELECT id FROM votes WHERE poll_id = ? AND voter_id = ?`).bind(pollId, voterId).first<{ id: number }>();
	return row!.id;
}

export async function setVoteSlots(db: D1Database, voteId: number, slotIds: number[]): Promise<void> {
	// Remove old slot selections for this vote, then insert new ones
	const del = db.prepare(`DELETE FROM vote_slots WHERE vote_id = ?`).bind(voteId);
	const inserts = slotIds.map((sid) => db.prepare(`INSERT INTO vote_slots (vote_id, slot_id) VALUES (?, ?)`).bind(voteId, sid));
	await db.batch([del, ...inserts]);
}

export async function getVotesByPollId(db: D1Database, pollId: string): Promise<Vote[]> {
	const result = await db.prepare(`SELECT * FROM votes WHERE poll_id = ?`).bind(pollId).all<Vote>();
	return result.results;
}

export async function getVoteByVoter(db: D1Database, pollId: string, voterId: string): Promise<Vote | null> {
	return db.prepare(`SELECT * FROM votes WHERE poll_id = ? AND voter_id = ?`).bind(pollId, voterId).first<Vote>();
}

/** Returns the slot IDs a voter previously selected for a given vote. */
export async function getVoteSlotsByVoteId(db: D1Database, voteId: number): Promise<number[]> {
	const result = await db.prepare(`SELECT slot_id FROM vote_slots WHERE vote_id = ?`).bind(voteId).all<{ slot_id: number }>();
	return result.results.map((r) => r.slot_id);
}

/** Returns slot_id → yes_voter_count for a poll. */
export async function getSlotVoteCounts(db: D1Database, pollId: string): Promise<Array<{ slot_id: number; count: number }>> {
	const result = await db
		.prepare(
			`SELECT vs.slot_id, COUNT(*) as count
       FROM vote_slots vs
       JOIN votes v ON v.id = vs.vote_id
       WHERE v.poll_id = ?
       GROUP BY vs.slot_id`
		)
		.bind(pollId)
		.all<{ slot_id: number; count: number }>();
	return result.results;
}

// ─── Analytics queries ─────────────────────────────────────────────────────────

export interface GameStat {
	game_name: string;
	poll_count: number;
	avg_yes: number;
	avg_no: number;
}

export async function getGameStats(db: D1Database, guildId: string): Promise<GameStat[]> {
	const result = await db
		.prepare(
			`SELECT
        p.game_name,
        COUNT(DISTINCT p.id) as poll_count,
        ROUND(AVG(yes_counts.cnt), 1) as avg_yes,
        ROUND(AVG(no_counts.cnt), 1) as avg_no
      FROM polls p
      LEFT JOIN (
        SELECT poll_id, COUNT(*) as cnt FROM votes WHERE vote_type = 'yes' GROUP BY poll_id
      ) yes_counts ON yes_counts.poll_id = p.id
      LEFT JOIN (
        SELECT poll_id, COUNT(*) as cnt FROM votes WHERE vote_type = 'no' GROUP BY poll_id
      ) no_counts ON no_counts.poll_id = p.id
      WHERE p.guild_id = ?
      GROUP BY p.game_name
      ORDER BY poll_count DESC`
		)
		.bind(guildId)
		.all<GameStat>();
	return result.results;
}

export interface PlayerStat {
	voter_name: string;
	total_votes: number;
	yes_votes: number;
}

export async function getPlayerStats(db: D1Database, guildId: string): Promise<PlayerStat[]> {
	const result = await db
		.prepare(
			`SELECT
        v.voter_name,
        COUNT(*) as total_votes,
        SUM(CASE WHEN v.vote_type = 'yes' THEN 1 ELSE 0 END) as yes_votes
      FROM votes v
      JOIN polls p ON p.id = v.poll_id
      WHERE p.guild_id = ?
      GROUP BY v.voter_id
      ORDER BY total_votes DESC
      LIMIT 10`
		)
		.bind(guildId)
		.all<PlayerStat>();
	return result.results;
}
