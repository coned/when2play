import { useState, useEffect, useMemo } from 'preact/hooks';
import { api } from '../../api/client';
import { getTimezoneAbbreviation, formatLocalRangeStructured, availabilityToday, type TimeRangeParts } from '../../lib/time';
import { gridOriginMinutes, slotStartOffset, minutesToHhmm, offsetToInstant } from '@when2play/shared';

interface ScheduleSummaryProps {
	userId: string;
}

interface SlotGroup {
	startTime: string;
	endTime: string;
	/** Minutes from the gaming day's grid origin (see @when2play/shared gaming-day helpers) */
	startOffset: number;
	endOffset: number;
	userIds: string[];
}

const SLOT_MINUTES = 15;

function setsEqual(a: Set<string>, b: Set<string>): boolean {
	if (a.size !== b.size) return false;
	for (const v of a) if (!b.has(v)) return false;
	return true;
}

/**
 * Merge adjacent 15 minute slots that share the same value into ranges, in chronological
 * order of the gaming day. Ordering uses the offset from the grid origin, so a range that
 * crosses UTC midnight (23:45 -> 00:00) stays one range.
 */
function groupByOffset<V>(
	slots: Array<{ time: string; value: V }>,
	origin: number,
	same: (a: V, b: V) => boolean,
): Array<{ startTime: string; endTime: string; startOffset: number; endOffset: number; value: V }> {
	const sorted = slots
		.map((s) => ({ ...s, offset: slotStartOffset(s.time, origin) }))
		.sort((a, b) => a.offset - b.offset);
	const groups: Array<{ startTime: string; endTime: string; startOffset: number; endOffset: number; value: V }> = [];
	for (const slot of sorted) {
		const last = groups[groups.length - 1];
		if (last && last.endOffset === slot.offset && same(last.value, slot.value)) {
			last.endOffset = slot.offset + SLOT_MINUTES;
			last.endTime = minutesToHhmm(origin + last.endOffset);
		} else {
			groups.push({
				startTime: slot.time,
				endTime: minutesToHhmm(origin + slot.offset + SLOT_MINUTES),
				startOffset: slot.offset,
				endOffset: slot.offset + SLOT_MINUTES,
				value: slot.value,
			});
		}
	}
	return groups;
}

function groupAdjacentSlots(slots: Array<[string, Set<string>]>, origin: number): SlotGroup[] {
	return groupByOffset(slots.map(([time, users]) => ({ time, value: users })), origin, setsEqual)
		.map(({ value, ...g }) => ({ ...g, userIds: Array.from(value) }));
}

function groupMySlots(slots: Array<{ start_time: string; slot_status?: string }>, origin: number): Array<Omit<SlotGroup, 'userIds'> & { slotStatus: string }> {
	return groupByOffset(slots.map((s) => ({ time: s.start_time, value: s.slot_status ?? 'available' })), origin, (a, b) => a === b)
		.map(({ value, ...g }) => ({ ...g, slotStatus: value }));
}

function DayBadge({ offset }: { offset: number }) {
	if (offset <= 0) return null;
	return (
		<>
			{' '}
			<span style={{ color: 'var(--warning)', fontSize: '0.75em', verticalAlign: 'super', fontWeight: 600 }}>
				+{offset}
			</span>
		</>
	);
}

function TimeRange({ parts }: { parts: TimeRangeParts }) {
	return (
		<>
			{parts.startTime}
			<DayBadge offset={parts.startDayOffset} />
			{' \u2013 '}
			{parts.endTime}
			<DayBadge offset={parts.endDayOffset} />
			{' '}{parts.tz}
		</>
	);
}

function AvatarRow({ users }: { users: Array<{ avatar_url: string | null; display_name: string | null; discord_username?: string }> }) {
	return (
		<div style={{ display: 'flex', alignItems: 'center' }}>
			{users.slice(0, 5).map((u, i) =>
				u.avatar_url ? (
					<img
						key={i}
						src={u.avatar_url}
						alt={u.display_name ?? ''}
						title={u.display_name ?? ''}
						style={{
							width: '18px',
							height: '18px',
							borderRadius: '50%',
							border: '1px solid var(--bg-secondary)',
							marginLeft: i > 0 ? '-4px' : 0,
							flexShrink: 0,
						}}
					/>
				) : (
					<span
						key={i}
						title={u.display_name ?? u.discord_username ?? ''}
						style={{
							width: '18px',
							height: '18px',
							borderRadius: '50%',
							background: 'var(--accent)',
							border: '1px solid var(--bg-secondary)',
							marginLeft: i > 0 ? '-4px' : 0,
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							fontSize: '9px',
							color: '#fff',
							flexShrink: 0,
						}}
					>
						{(u.display_name ?? u.discord_username ?? '?')[0].toUpperCase()}
					</span>
				),
			)}
			{users.length > 5 && (
				<span style={{ fontSize: '10px', color: 'var(--text-muted)', marginLeft: '3px', fontWeight: 600 }}>
					+{users.length - 5}
				</span>
			)}
		</div>
	);
}

export function ScheduleSummary({ userId }: ScheduleSummaryProps) {
	const [games, setGames] = useState<any[]>([]);
	const [topGames, setTopGames] = useState<any[]>([]);
	const [ranking, setRanking] = useState<any[]>([]);
	const [availability, setAvailability] = useState<any[]>([]);
	const [userMap, setUserMap] = useState<Map<string, { discord_username: string; display_name: string | null; avatar_url: string | null }>>(new Map());
	const [guildName, setGuildName] = useState<string | null>(null);
	const [loading, setLoading] = useState(true);
	const [today, setToday] = useState(availabilityToday(5));
	// Grid origin of `today` in minutes after 00:00 UTC (0 until settings say otherwise)
	const [gridOrigin, setGridOrigin] = useState(0);
	const [otherGuilds, setOtherGuilds] = useState<Array<{ guild_id: string; guild_name: string | null }>>([]);
	const [guildDropdownOpen, setGuildDropdownOpen] = useState(false);
	const [switching, setSwitching] = useState(false);

	const todayDate = new Date(today + 'T12:00:00Z');
	const todayLabel = todayDate.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

	useEffect(() => {
		(async () => {
			const [gamesResult, rankResult, usersResult, settingsResult, guildsResult] = await Promise.all([
				api.getGames(),
				api.getGameRanking(),
				api.getUsers(),
				api.getSettings(),
				api.getMyGuilds(),
			]);

			let effectiveToday = availabilityToday(5);
			if (settingsResult.ok) {
				const s = settingsResult.data as Record<string, unknown>;
				if (typeof s.day_cutoff_hour_et === 'number') {
					effectiveToday = availabilityToday(s.day_cutoff_hour_et);
				}
				if (typeof s.guild_name === 'string') {
					setGuildName(s.guild_name);
				}
				setGridOrigin(gridOriginMinutes(effectiveToday, s.avail_start_hour_et as number | undefined, s.avail_end_hour_et as number | undefined));
			}
			setToday(effectiveToday);

			if (guildsResult.ok) {
				const current = guildsResult.data.current_guild_id;
				setOtherGuilds(guildsResult.data.guilds.filter(g => g.guild_id !== current));
			}

			const availResult = await api.getAvailability({ date: effectiveToday });

			// Top games by net reaction score (likes - dislikes)
			if (gamesResult.ok) {
				setGames(gamesResult.data);
				const sorted = [...gamesResult.data]
					.map((g: any) => ({ ...g, net_score: (g.like_count ?? 0) - (g.dislike_count ?? 0) }))
					.sort((a: any, b: any) => b.net_score - a.net_score)
					.slice(0, 5);
				setTopGames(sorted);
			}

			if (rankResult.ok) {
				setRanking(rankResult.data);
			} else {
				console.warn('[ScheduleSummary] ranking failed:', rankResult);
			}
			if (availResult.ok) {
				setAvailability(availResult.data);
			} else {
				console.warn('[ScheduleSummary] availability failed:', availResult);
			}
			if (usersResult.ok) {
				const map = new Map<string, { discord_username: string; display_name: string | null; avatar_url: string | null }>();
				for (const u of usersResult.data) map.set(u.id, u);
				setUserMap(map);
			}
			setLoading(false);
		})();
	}, []);

	const randomGame = useMemo(() => {
		const active = games.filter((g: any) => !g.is_archived);
		if (active.length === 0) return null;
		return active[Math.floor(Math.random() * active.length)];
	}, [games]);

	if (loading) return <div class="spinner" style={{ margin: '20px auto' }} />;

	// Compute overlap windows: map start_time -> Set of user_ids
	const slotUsers = new Map<string, Set<string>>();
	for (const slot of availability) {
		if (!slotUsers.has(slot.start_time)) slotUsers.set(slot.start_time, new Set());
		slotUsers.get(slot.start_time)!.add(slot.user_id);
	}

	// Per-slot per-user status: key = "start_time:user_id"
	const slotUserInfo = new Map<string, { status: string; slotStatus: string }>();
	// Per-user aggregate (for My Availability section)
	const userStatusMap = new Map<string, { status: string }>();
	for (const slot of availability) {
		const dateStatus = slot.status ?? 'manual';
		slotUserInfo.set(`${slot.start_time}:${slot.user_id}`, {
			status: dateStatus,
			slotStatus: slot.slot_status ?? 'available',
		});
		const existing = userStatusMap.get(slot.user_id);
		if (!existing) {
			userStatusMap.set(slot.user_id, { status: dateStatus });
		} else if (dateStatus === 'tentative') {
			existing.status = 'tentative';
		}
	}

	const hasMultiUserOverlap = Array.from(slotUsers.values()).some((users) => users.size >= 2);
	const minUsers = hasMultiUserOverlap ? 2 : 1;
	const overlapSlots = Array.from(slotUsers.entries()).filter(([, users]) => users.size >= minUsers);
	// Already in chronological order of the gaming day
	const overlapGroups = groupAdjacentSlots(overlapSlots, gridOrigin);
	const rangeParts = (g: { startOffset: number; endOffset: number }) => formatLocalRangeStructured(
		offsetToInstant(today, gridOrigin, g.startOffset),
		offsetToInstant(today, gridOrigin, g.endOffset),
		today,
	);

	return (
		<div>
			<h2 style={{ marginBottom: guildName ? '2px' : '8px' }}>Dashboard</h2>
			{guildName && (
				<div style={{ marginBottom: '4px', display: 'flex', alignItems: 'center', gap: '6px', position: 'relative' }}>
					<p style={{ fontSize: '14px', color: 'var(--text-secondary)', fontWeight: 600, margin: 0 }}>{guildName}</p>
					{otherGuilds.length > 0 && (
						<>
							<button
								onClick={() => setGuildDropdownOpen(v => !v)}
								disabled={switching}
								title="Switch guild"
								style={{
									background: 'none',
									border: '1px solid var(--border)',
									borderRadius: '4px',
									padding: '2px 5px',
									cursor: switching ? 'wait' : 'pointer',
									color: 'var(--text-muted)',
									fontSize: '12px',
									lineHeight: 1,
									display: 'flex',
									alignItems: 'center',
								}}
							>
								{switching ? '...' : '\u21C5'}
							</button>
							{guildDropdownOpen && (
								<div
									style={{
										position: 'absolute',
										top: '100%',
										left: 0,
										marginTop: '4px',
										background: 'var(--bg-secondary)',
										border: '1px solid var(--border)',
										borderRadius: 'var(--radius)',
										padding: '4px 0',
										zIndex: 100,
										minWidth: '160px',
										boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
									}}
								>
									{otherGuilds.map(g => (
										<button
											key={g.guild_id}
											onClick={async () => {
												setSwitching(true);
												setGuildDropdownOpen(false);
												const res = await api.switchGuild(g.guild_id);
												if (res.ok) {
													window.location.reload();
												} else {
													setSwitching(false);
												}
											}}
											style={{
												display: 'block',
												width: '100%',
												background: 'none',
												border: 'none',
												padding: '6px 12px',
												textAlign: 'left',
												color: 'var(--text-primary)',
												fontSize: '13px',
												cursor: 'pointer',
											}}
											onMouseEnter={(e) => { (e.target as HTMLElement).style.background = 'var(--bg-tertiary)'; }}
											onMouseLeave={(e) => { (e.target as HTMLElement).style.background = 'none'; }}
										>
											{g.guild_name ?? g.guild_id}
										</button>
									))}
								</div>
							)}
						</>
					)}
				</div>
			)}
			<p style={{ marginBottom: '20px', fontSize: '13px', color: 'var(--text-muted)' }}>
				Times shown in {getTimezoneAbbreviation()} (local time)
			</p>

			{/* Top Games from the Pool */}
			<div style={{ marginBottom: '24px' }}>
				<h3 style={{ marginBottom: '12px', fontSize: '16px', color: 'var(--text-secondary)' }}>Top Games from the Pool</h3>
				{topGames.length === 0 ? (
					<p class="text-muted">No games in the pool yet.</p>
				) : (
					<div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxWidth: '480px' }}>
						{topGames.map((item, i) => {
							const likeUsers = (item.reaction_users ?? []).filter((u: any) => u.type === 'like');
							const dislikeUsers = (item.reaction_users ?? []).filter((u: any) => u.type === 'dislike');
							return (
								<div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
									<span style={{ color: 'var(--accent)', fontWeight: 700, minWidth: '24px' }}>#{i + 1}</span>
									<span style={{ flex: 1 }}>{item.name}</span>
									{item.net_score !== 0 && (
										<span style={{
											fontSize: '12px',
											fontWeight: 600,
											color: item.net_score > 0 ? 'var(--success)' : 'var(--danger)',
										}}>
											{item.net_score > 0 ? `+${item.net_score}` : item.net_score}
										</span>
									)}
									{likeUsers.length > 0 && (
										<div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
											<span style={{ fontSize: '10px' }}>{'\u2764\uFE0F'}</span>
											<AvatarRow users={likeUsers} />
										</div>
									)}
									{dislikeUsers.length > 0 && (
										<div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
											<span style={{ fontSize: '10px' }}>&#x1F44E;</span>
											<AvatarRow users={dislikeUsers} />
										</div>
									)}
								</div>
							);
						})}
					</div>
				)}
			</div>

			{/* Suggestion for Today */}
			<div style={{ marginBottom: '24px' }}>
				<h3 style={{ marginBottom: '12px', fontSize: '16px', color: 'var(--text-secondary)' }}>Suggestion for Today</h3>
				{ranking.length === 0 ? (
					randomGame ? (
						<div>
							<div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
								<span style={{ flex: 1 }}>{randomGame.name}</span>
								<span class="badge badge-warning">Feeling lucky?</span>
							</div>
							<p style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
								No votes yet - showing a random pick from the pool.
							</p>
						</div>
					) : (
						<p class="text-muted">No votes cast yet.</p>
					)
				) : (
					<div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxWidth: '480px' }}>
						{ranking.slice(0, 5).map((item, i) => (
							<div key={item.game_id} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
								<span style={{ color: 'var(--accent)', fontWeight: 700, minWidth: '24px' }}>#{i + 1}</span>
								<span style={{ flex: 1 }}>{item.name}</span>
								{item.vote_count >= 2 && (
									<span class="text-muted" style={{ fontSize: '12px' }}>
										{item.total_score} pts
									</span>
								)}
								{item.vote_count > 0 && (
									<span class="text-muted" style={{ fontSize: '12px' }}>
										{item.vote_count} {item.vote_count === 1 ? 'vote' : 'votes'}
									</span>
								)}
							</div>
						))}
					</div>
				)}
			</div>

			{/* Overlap Windows */}
			<section aria-labelledby="whos-around-heading" style={{ marginBottom: '24px' }}>
				<h3 id="whos-around-heading" style={{ marginBottom: '12px', fontSize: '16px', color: 'var(--text-secondary)' }}>Who's Around -- {todayLabel}</h3>
				{overlapGroups.length === 0 ? (
					<p class="text-muted">No overlapping availability yet.</p>
				) : (
					<div role="list" style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
						{overlapGroups.map((group) => {
							const shown = group.userIds.slice(0, 4);
							const overflow = group.userIds.length - shown.length;

							return (
								<div
									key={`${group.startTime}-${group.endTime}`}
									role="listitem"
									style={{
										background: 'var(--bg-tertiary)',
										border: '1px solid var(--success)',
										borderRadius: 'var(--radius)',
										padding: '6px 10px',
										fontSize: '12px',
										display: 'flex',
										alignItems: 'center',
										gap: '8px',
									}}
								>
									<span style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
										<TimeRange parts={rangeParts(group)} />
									</span>

									{/* Avatar stack */}
									<div style={{ display: 'flex', alignItems: 'center' }}>
										{shown.map((uid, i) => {
											const user = userMap.get(uid);
											const info = slotUserInfo.get(`${group.startTime}:${uid}`);
											// Ring style per slot: dashed gray for auto-filled, amber for tentative slot, green for available
											let ringBorder = '2px solid var(--success)';
											if (info?.status === 'tentative') {
												ringBorder = '2px dashed var(--text-muted)';
											} else if (info?.slotStatus === 'tentative') {
												ringBorder = '2px solid var(--warning)';
											}
											const name = user?.display_name ?? user?.discord_username ?? uid;
											return (
												<div
													key={uid}
													title={name}
													style={{
														width: '18px',
														height: '18px',
														borderRadius: '50%',
														border: ringBorder,
														boxSizing: 'border-box',
														marginLeft: i > 0 ? '-4px' : 0,
														flexShrink: 0,
														overflow: 'hidden',
														background: 'var(--bg-card)',
														position: 'relative',
													}}
												>
													{user?.avatar_url ? (
														<img
															src={user.avatar_url}
															alt={name}
															style={{ width: '100%', height: '100%', display: 'block', borderRadius: '50%' }}
														/>
													) : (
														<span
															style={{
																display: 'flex',
																alignItems: 'center',
																justifyContent: 'center',
																width: '100%',
																height: '100%',
																fontSize: '8px',
																fontWeight: 600,
																color: 'var(--text-muted)',
																background: 'var(--bg-tertiary)',
															}}
														>
															{name[0].toUpperCase()}
														</span>
													)}
												</div>
											);
										})}
										{overflow > 0 && (
											<span
												style={{
													fontSize: '10px',
													color: 'var(--success)',
													marginLeft: '3px',
													fontWeight: 600,
												}}
											>
												+{overflow}
											</span>
										)}
									</div>
								</div>
							);
						})}
					</div>
				)}
			</section>

			{/* My Availability */}
			<div>
				<h3 style={{ marginBottom: '12px', fontSize: '16px', color: 'var(--text-secondary)' }}>My Availability -- {todayLabel}</h3>
				{(() => {
					const mySlots = availability.filter((s) => s.user_id === userId);
					const myInfo = userStatusMap.get(userId);
					const myGroups = groupMySlots(mySlots, gridOrigin);

					if (myGroups.length === 0) return <p class="text-muted">You haven't set availability for today.</p>;

					return (
						<div>
							{myInfo?.status === 'tentative' && (
								<p style={{ fontSize: '11px', color: 'var(--warning)', marginBottom: '6px' }}>
									Auto-filled from last week (pending confirm)
								</p>
							)}
							<div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
								{myGroups.map((g) => (
									<span
										key={`${g.startTime}-${g.endTime}`}
										style={{
											background: g.slotStatus === 'tentative' ? 'var(--warning)' : 'var(--accent)',
											color: '#fff',
											padding: '4px 8px',
											borderRadius: '4px',
											fontSize: '12px',
										}}
									>
										<TimeRange parts={rangeParts(g)} />
									</span>
								))}
							</div>
						</div>
					);
				})()}
			</div>
		</div>
	);
}
