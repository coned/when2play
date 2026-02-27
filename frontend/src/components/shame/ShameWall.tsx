import { useState, useEffect } from 'preact/hooks';
import { api } from '../../api/client';

interface ShameWallProps {
	userId: string;
}

export function ShameWall({ userId }: ShameWallProps) {
	const [leaderboard, setLeaderboard] = useState<any[]>([]);
	const [users, setUsers] = useState<Array<{ id: string; discord_username: string; avatar_url: string | null }>>([]);
	const [myVotes, setMyVotes] = useState<Set<string>>(new Set());
	const [loading, setLoading] = useState(true);
	const [expandedTarget, setExpandedTarget] = useState<string | null>(null);
	const [reasons, setReasons] = useState<Record<string, string>>({});
	const [error, setError] = useState('');

	useEffect(() => {
		fetchData();
	}, []);

	const fetchData = async () => {
		setLoading(true);
		const [lbResult, usersResult, myVotesResult] = await Promise.all([
			api.getShameLeaderboard(),
			api.getUsers(),
			api.getMyShameVotes(),
		]);
		if (lbResult.ok) setLeaderboard(lbResult.data);
		if (usersResult.ok) setUsers(usersResult.data);
		if (myVotesResult.ok) setMyVotes(new Set(myVotesResult.data));
		setLoading(false);
	};

	const refreshShameData = async () => {
		const [lbResult, myVotesResult] = await Promise.all([
			api.getShameLeaderboard(),
			api.getMyShameVotes(),
		]);
		if (lbResult.ok) setLeaderboard(lbResult.data);
		if (myVotesResult.ok) setMyVotes(new Set(myVotesResult.data));
	};

	const handleShame = async (targetId: string) => {
		setError('');
		const reason = reasons[targetId]?.trim();
		const result = await api.shameUser(targetId, reason || undefined);
		if (result.ok) {
			setReasons((prev) => ({ ...prev, [targetId]: '' }));
			setExpandedTarget(null);
			refreshShameData();
		} else {
			setError(result.error.message);
		}
	};

	const handleWithdraw = async (targetId: string) => {
		setError('');
		const result = await api.withdrawShame(targetId);
		if (result.ok) {
			setExpandedTarget(null);
			refreshShameData();
		} else {
			setError(result.error.message);
		}
	};

	if (loading) return <div class="spinner" style={{ margin: '20px auto' }} />;

	// Build a unified user map: all users, merging shame counts from leaderboard
	const shameMap = new Map(leaderboard.map((e: any) => [e.user_id, e]));
	const allUsers = users.map((u) => ({
		...u,
		shame_count: shameMap.get(u.id)?.shame_count ?? 0,
		recent_reasons: shameMap.get(u.id)?.recent_reasons ?? [],
	}));

	// Sort by shame count desc, then username
	const sortedUsers = [...allUsers].sort((a, b) => b.shame_count - a.shame_count || a.discord_username.localeCompare(b.discord_username));

	return (
		<div>
			<h2 style={{ marginBottom: '8px' }}>Shame Wall</h2>
			<p style={{ marginBottom: '20px', fontSize: '13px', color: 'var(--text-muted)' }}>
				Shame a friend (or yourself) who no-showed, went AFK, or dodged. Once per target per day.
			</p>

			{error && <p style={{ color: 'var(--danger)', fontSize: '13px', marginBottom: '12px' }}>{error}</p>}

			{sortedUsers.length === 0 ? (
				<p class="text-muted" style={{ textAlign: 'center', padding: '40px' }}>
					No users yet.
				</p>
			) : (
				<div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: '520px', width: '100%' }}>
					{sortedUsers.map((u, i) => {
						const isMe = u.id === userId;
						const alreadyShamed = myVotes.has(u.id);
						const isExpanded = expandedTarget === u.id;

						return (
							<div key={u.id}>
								<div
									class="card"
									style={{
										display: 'flex',
										alignItems: 'center',
										gap: '12px',
										padding: '12px 16px',
									}}
								>
									{/* Rank badge for top 3 with shames */}
									{u.shame_count > 0 && (
										<span
											style={{
												fontSize: '18px',
												fontWeight: 700,
												color: i === 0 ? 'var(--shame)' : 'var(--text-muted)',
												minWidth: '28px',
											}}
										>
											#{i + 1}
										</span>
									)}

									{u.avatar_url && (
										<img
											src={u.avatar_url}
											alt={u.discord_username}
											style={{ width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0 }}
										/>
									)}

									<div style={{ flex: 1, minWidth: 0 }}>
										<span style={{ fontWeight: 500 }}>
											{u.discord_username}
											{isMe && (
												<span style={{ fontSize: '11px', color: 'var(--text-muted)', marginLeft: '6px' }}>(you)</span>
											)}
										</span>
										{u.recent_reasons?.length > 0 && (
											<div style={{ marginTop: '3px' }}>
												{u.recent_reasons.map((r: string, j: number) => (
													<span key={j} style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block' }}>
														"{r}"
													</span>
												))}
											</div>
										)}
									</div>

									{u.shame_count > 0 && (
										<span class="badge badge-danger" style={{ flexShrink: 0 }}>
											{u.shame_count} {u.shame_count === 1 ? 'shame' : 'shames'}
										</span>
									)}

									{alreadyShamed ? (
										<button
											class="btn btn-secondary"
											style={{ padding: '2px 8px', fontSize: '11px', flexShrink: 0 }}
											onClick={() => handleWithdraw(u.id)}
										>
											Withdraw
										</button>
									) : (
										<button
											class="btn btn-secondary"
											style={{ padding: '2px 8px', fontSize: '11px', flexShrink: 0 }}
											onClick={() => setExpandedTarget(isExpanded ? null : u.id)}
										>
											Shame
										</button>
									)}
								</div>

								{isExpanded && !alreadyShamed && (
									<div style={{ display: 'flex', gap: '8px', padding: '8px 16px', background: 'var(--bg-secondary)', borderRadius: '0 0 var(--radius) var(--radius)' }}>
										<input
											type="text"
											placeholder="Reason (optional)"
											value={reasons[u.id] || ''}
											onInput={(e) =>
												setReasons((prev) => ({ ...prev, [u.id]: (e.target as HTMLInputElement).value }))
											}
											style={{ flex: 1, fontSize: '13px', padding: '4px 8px' }}
											maxLength={200}
										/>
										<button
											class="btn btn-danger"
											style={{ padding: '4px 10px', fontSize: '12px' }}
											onClick={() => handleShame(u.id)}
										>
											Confirm
										</button>
									</div>
								)}
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
