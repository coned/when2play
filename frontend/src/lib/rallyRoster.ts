import { ANONYMOUS_ACTOR_ID } from '@when2play/shared';

/** Answers that put someone on today's roster. */
export const ROSTER_STATUSES = ['in', 'brb', 'out'] as const;
export type RosterStatus = (typeof ROSTER_STATUSES)[number];

export interface RosterAction {
	actor_id: string;
	action_type: string;
	actor_username?: string | null;
	actor_avatar?: string | null;
	metadata?: Record<string, unknown> | null;
	created_at: string;
}

export interface RosterEntry {
	userId: string;
	name: string;
	avatarUrl: string | null;
	/** Time of the answer that decided the group */
	at: string;
}

export type Roster = Record<RosterStatus, RosterEntry[]>;

type UserInfo = { discord_username: string; display_name: string | null; avatar_url: string | null };

function isRosterStatus(type: string): type is RosterStatus {
	return (ROSTER_STATUSES as readonly string[]).includes(type);
}

/**
 * Today's roster from the rally actions: for every user who is not anonymous, their
 * latest in / out / brb decides the group. Anonymous actions are ignored (they name
 * no one). Names and avatars come from the user list when it has the user, else
 * from the action. Each group is sorted by name.
 */
export function buildRoster(actions: RosterAction[], users?: Map<string, UserInfo>): Roster {
	const latest = new Map<string, RosterAction>();
	for (const a of actions) {
		if (!isRosterStatus(a.action_type)) continue;
		if (a.actor_id === ANONYMOUS_ACTOR_ID || a.metadata?.is_anonymous === true) continue;
		const prev = latest.get(a.actor_id);
		// ISO timestamps compare as strings; equal times keep the later one in the list
		if (!prev || a.created_at >= prev.created_at) latest.set(a.actor_id, a);
	}

	const roster: Roster = { in: [], brb: [], out: [] };
	for (const [userId, a] of latest) {
		const u = users?.get(userId);
		roster[a.action_type as RosterStatus].push({
			userId,
			name: u?.display_name || u?.discord_username || a.actor_username || 'Someone',
			avatarUrl: u?.avatar_url ?? a.actor_avatar ?? null,
			at: a.created_at,
		});
	}
	for (const s of ROSTER_STATUSES) roster[s].sort((x, y) => x.name.localeCompare(y.name));
	return roster;
}

/** "3 in, 1 brb, 2 out" (groups with nobody left out); "" when nobody has answered. */
export function rosterSummary(roster: Roster): string {
	return ROSTER_STATUSES.filter((s) => roster[s].length > 0)
		.map((s) => `${roster[s].length} ${s}`)
		.join(', ');
}
