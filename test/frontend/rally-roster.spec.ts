import { ANONYMOUS_ACTOR_ID } from '@when2play/shared';
import { buildRoster, rosterSummary, type RosterAction } from '../../frontend/src/lib/rallyRoster';

const act = (actor_id: string, action_type: string, minute: number, extra: Partial<RosterAction> = {}): RosterAction => ({
	actor_id,
	action_type,
	actor_username: actor_id,
	actor_avatar: null,
	metadata: null,
	created_at: `2026-10-03T20:${String(minute).padStart(2, '0')}:00.000Z`,
	...extra,
});

describe('buildRoster', () => {
	it('puts each user in the group of their latest in / out / brb', () => {
		const roster = buildRoster([
			act('u1', 'in', 1),
			act('u2', 'in', 2),
			act('u1', 'out', 3),
			act('u3', 'brb', 4),
			act('u2', 'call', 5),
			act('u2', 'ping', 6),
		]);
		expect(roster.in.map((e) => e.userId)).toEqual(['u2']);
		expect(roster.out.map((e) => e.userId)).toEqual(['u1']);
		expect(roster.brb.map((e) => e.userId)).toEqual(['u3']);
		expect(rosterSummary(roster)).toBe('1 in, 1 brb, 1 out');
	});

	it('uses timestamps, not list order', () => {
		const roster = buildRoster([act('u1', 'out', 9), act('u1', 'in', 2)]);
		expect(roster.out.map((e) => e.userId)).toEqual(['u1']);
		expect(roster.in).toEqual([]);
	});

	it('ignores anonymous actions', () => {
		const roster = buildRoster([
			act('u1', 'in', 1),
			act(ANONYMOUS_ACTOR_ID, 'out', 2, { actor_username: 'Anonymous' }),
			act('u1', 'out', 3, { metadata: { is_anonymous: true } }),
		]);
		expect(roster.in.map((e) => e.userId)).toEqual(['u1']);
		expect(roster.out).toEqual([]);
	});

	it('prefers the user list for names and avatars', () => {
		const users = new Map([['u1', { discord_username: 'alice', display_name: 'Alice A', avatar_url: 'https://e/a.png' }]]);
		const roster = buildRoster([act('u1', 'in', 1), act('u9', 'in', 2, { actor_username: 'zed' })], users);
		expect(roster.in).toEqual([
			{ userId: 'u1', name: 'Alice A', avatarUrl: 'https://e/a.png', at: '2026-10-03T20:01:00.000Z' },
			{ userId: 'u9', name: 'zed', avatarUrl: null, at: '2026-10-03T20:02:00.000Z' },
		]);
	});

	it('is empty without answers', () => {
		const roster = buildRoster([act('u1', 'call', 1)]);
		expect(rosterSummary(roster)).toBe('');
	});
});
