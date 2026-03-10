import { useState, useEffect, useMemo } from 'preact/hooks';
import { api } from '../../api/client';
import { getTimezoneAbbreviation, formatLocalTimeRangeStructured, availabilityToday, type TimeRangeParts } from '../../lib/time';

interface ScheduleSummaryProps {
	userId: string;
}

interface SlotGroup {
	startTime: string;
	endTime: string;
	userIds: string[];
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
	if (a.size !== b.size) return false;
	for (const v of a) if (!b.has(v)) return false;
	return true;
}

function addMinutes(hhmm: string, minutes: number): string {
	const [h, m] = hhmm.split(':').map(Number);
	const total = (h * 60 + m + minutes) % (24 * 60);
	return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function groupAdjacentSlots(slots: Array<[string, Set<string>]>): SlotGroup[] {
	if (slots.length === 0) return [];

	const sorted = [...slots].sort(([a], [b]) => a.localeCompare(b));
	const groups: SlotGroup[] = [];
	let currentStart = sorted[0][0];
	let currentEnd = addMinutes(sorted[0][0], 15);
	let currentUsers = sorted[0][1];

	for (let i = 1; i < sorted.length; i++) {
		const [time, users] = sorted[i];
		if (time === currentEnd && setsEqual(users, currentUsers)) {
			currentEnd = addMinutes(time, 15);
		} else {
			groups.push({ startTime: currentStart, endTime: currentEnd, userIds: Array.from(currentUsers) });
			currentStart = time;
			currentEnd = addMinutes(time, 15);
			currentUsers = users;
		}
	}
	groups.push({ startTime: currentStart, endTime: currentEnd, userIds: Array.from(currentUsers) });

	return groups;
}

function groupMySlots(slots: Array<{ start_time: string }>): Array<{ startTime: string; endTime: string }> {
	if (slots.length === 0) return [];

	const sorted = [...slots].sort((a, b) => a.start_time.localeCompare(b.start_time));
	const groups: Array<{ startTime: string; endTime: string }> = [];
	let currentStart = sorted[0].start_time;
	let currentEnd = addMinutes(sorted[0].start_time, 15);

	for (let i = 1; i < sorted.length; i++) {
		const time = sorted[i].start_time;
		if (time === currentEnd) {
			currentEnd = addMinutes(time, 15);
		} else {
			groups.push({ startTime: currentStart, endTime: currentEnd });
			currentStart = time;
			currentEnd = addMinutes(time, 15);
		}
	}
	groups.push({ startTime: currentStart, endTime: currentEnd });

	return groups;
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

/** Sort key: local time of day in minutes, for displaying times in local order */
function localSortKey(utcHHMM: string, dateStr: string): number {
	const d = new Date(`${dateStr}T${utcHHMM}:00Z`);
	if (isNaN(d.getTime())) return 0;
	return d.getHours() * 60 + d.getMinutes();
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

	const overlapSlots = Array.from(slotUsers.entries()).filter(([, users]) => users.size >= 2);
	const overlapGroups = groupAdjacentSlots(overlapSlots);
	overlapGroups.sort((a, b) => localSortKey(a.startTime, today) - localSortKey(b.startTime, today));

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
					<div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
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
					<div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
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
			<div style={{ marginBottom: '24px' }}>
				<h3 style={{ marginBottom: '12px', fontSize: '16px', color: 'var(--text-secondary)' }}>Who's Around -- {todayLabel}</h3>
				{overlapGroups.length === 0 ? (
					<p class="text-muted">No overlapping availability yet.</p>
				) : (
					<div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
						{overlapGroups.map((group) => {
							const shown = group.userIds.slice(0, 4);
							const overflow = group.userIds.length - shown.length;

							return (
								<div
									key={`${group.startTime}-${group.endTime}`}
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
										<TimeRange parts={formatLocalTimeRangeStructured(group.startTime, group.endTime, today)} />
									</span>

									{/* Avatar stack */}
									<div style={{ display: 'flex', alignItems: 'center' }}>
										{shown.map((uid, i) => {
											const user = userMap.get(uid);
											return user?.avatar_url ? (
												<img
													key={uid}
													src={user.avatar_url}
													alt={user.display_name ?? user.discord_username}
													title={user.display_name ?? user.discord_username}
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
													key={uid}
													title={user?.display_name ?? user?.discord_username ?? uid}
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
													{(user?.display_name ?? user?.discord_username ?? '?')[0].toUpperCase()}
												</span>
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
			</div>

			{/* My Availability */}
			<div>
				<h3 style={{ marginBottom: '12px', fontSize: '16px', color: 'var(--text-secondary)' }}>My Availability -- {todayLabel}</h3>
				{(() => {
					const mySlots = availability.filter((s) => s.user_id === userId);
					const myGroups = groupMySlots(mySlots);
					myGroups.sort((a, b) => localSortKey(a.startTime, today) - localSortKey(b.startTime, today));
					if (myGroups.length === 0) return <p class="text-muted">You haven't set availability for today.</p>;
					return (
						<div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
							{myGroups.map((g) => (
								<span
									key={`${g.startTime}-${g.endTime}`}
									style={{
										background: 'var(--accent)',
										color: '#fff',
										padding: '4px 8px',
										borderRadius: '4px',
										fontSize: '12px',
									}}
								>
									<TimeRange parts={formatLocalTimeRangeStructured(g.startTime, g.endTime, today)} />
								</span>
							))}
						</div>
					);
				})()}
			</div>
		</div>
	);
}
