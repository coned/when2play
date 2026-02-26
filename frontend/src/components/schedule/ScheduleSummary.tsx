import { useState, useEffect } from 'preact/hooks';
import { api } from '../../api/client';
import { getTimezoneAbbreviation, formatLocalTime } from '../../lib/time';

interface ScheduleSummaryProps {
	userId: string;
}

export function ScheduleSummary({ userId }: ScheduleSummaryProps) {
	const [ranking, setRanking] = useState<any[]>([]);
	const [availability, setAvailability] = useState<any[]>([]);
	const [userMap, setUserMap] = useState<Map<string, { discord_username: string; avatar_url: string | null }>>(new Map());
	const [loading, setLoading] = useState(true);

	const today = new Date().toISOString().split('T')[0];

	useEffect(() => {
		(async () => {
			const [rankResult, availResult, usersResult] = await Promise.all([
				api.getGameRanking(),
				api.getAvailability({ date: today }),
				api.getUsers(),
			]);

			if (rankResult.ok) setRanking(rankResult.data);
			if (availResult.ok) setAvailability(availResult.data);
			if (usersResult.ok) {
				const map = new Map<string, { discord_username: string; avatar_url: string | null }>();
				for (const u of usersResult.data) map.set(u.id, u);
				setUserMap(map);
			}
			setLoading(false);
		})();
	}, []);

	if (loading) return <div class="spinner" style={{ margin: '20px auto' }} />;

	// Compute overlap windows: map start_time → Set of user_ids
	const slotUsers = new Map<string, Set<string>>();
	for (const slot of availability) {
		if (!slotUsers.has(slot.start_time)) slotUsers.set(slot.start_time, new Set());
		slotUsers.get(slot.start_time)!.add(slot.user_id);
	}

	const overlapSlots = Array.from(slotUsers.entries())
		.filter(([, users]) => users.size >= 2)
		.sort(([a], [b]) => a.localeCompare(b));

	return (
		<div>
			<h2 style={{ marginBottom: '8px' }}>Schedule Summary</h2>
			<p style={{ marginBottom: '20px', fontSize: '13px', color: 'var(--text-muted)' }}>
				Times shown in {getTimezoneAbbreviation()} (local time)
			</p>

			{/* Top Games */}
			<div style={{ marginBottom: '24px' }}>
				<h3 style={{ marginBottom: '12px', fontSize: '16px', color: 'var(--text-secondary)' }}>Top Games</h3>
				{ranking.length === 0 ? (
					<p class="text-muted">No games with votes yet.</p>
				) : (
					<div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
						{ranking.slice(0, 5).map((item, i) => (
							<div key={item.game_id} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
								<span style={{ color: 'var(--accent)', fontWeight: 700, minWidth: '24px' }}>#{i + 1}</span>
								<span>{item.name}</span>
								{item.vote_count >= 2 && (
									<span class="text-muted" style={{ fontSize: '12px' }}>
										{item.total_score} pts
									</span>
								)}
							</div>
						))}
					</div>
				)}
			</div>

			{/* Overlap Windows */}
			<div style={{ marginBottom: '24px' }}>
				<h3 style={{ marginBottom: '12px', fontSize: '16px', color: 'var(--text-secondary)' }}>Who's Around Today</h3>
				{overlapSlots.length === 0 ? (
					<p class="text-muted">No overlapping availability yet.</p>
				) : (
					<div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
						{overlapSlots.map(([time, userIds]) => {
							const ids = Array.from(userIds);
							const shown = ids.slice(0, 4);
							const overflow = ids.length - shown.length;

							return (
								<div
									key={time}
									style={{
										background: 'var(--bg-tertiary)',
										border: '1px solid var(--success)',
										borderRadius: 'var(--radius)',
										padding: '6px 10px',
										fontSize: '12px',
										display: 'flex',
										alignItems: 'center',
										gap: '6px',
									}}
								>
									<span style={{ fontWeight: 600 }}>{formatLocalTime(time, today)}</span>

									{/* Avatar stack */}
									<div style={{ display: 'flex', alignItems: 'center' }}>
										{shown.map((uid, i) => {
											const user = userMap.get(uid);
											return user?.avatar_url ? (
												<img
													key={uid}
													src={user.avatar_url}
													alt={user.discord_username}
													title={user.discord_username}
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
													title={user?.discord_username ?? uid}
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
													{(user?.discord_username ?? '?')[0].toUpperCase()}
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
				<h3 style={{ marginBottom: '12px', fontSize: '16px', color: 'var(--text-secondary)' }}>My Availability Today</h3>
				{(() => {
					const mySlots = availability.filter((s) => s.user_id === userId);
					if (mySlots.length === 0) return <p class="text-muted">You haven't set availability for today.</p>;
					return (
						<div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
							{mySlots.map((s) => (
								<span
									key={s.id}
									style={{
										background: 'var(--accent)',
										color: '#fff',
										padding: '4px 8px',
										borderRadius: '4px',
										fontSize: '12px',
									}}
								>
									{formatLocalTime(s.start_time, today)}
								</span>
							))}
						</div>
					);
				})()}
			</div>
		</div>
	);
}
