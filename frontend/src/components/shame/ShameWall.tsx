import { useState, useEffect } from 'preact/hooks';
import { api } from '../../api/client';

interface ShameWallProps {
	userId: string;
}

export function ShameWall({ userId }: ShameWallProps) {
	const [leaderboard, setLeaderboard] = useState<any[]>([]);
	const [users, setUsers] = useState<Array<{ id: string; discord_username: string; avatar_url: string | null }>>([]);
	const [loading, setLoading] = useState(true);
	const [expandedTarget, setExpandedTarget] = useState<string | null>(null);
	const [reasons, setReasons] = useState<Record<string, string>>({});
	const [error, setError] = useState('');

	useEffect(() => {
		fetchData();
	}, []);

	const fetchData = async () => {
		setLoading(true);
		const [lbResult, usersResult] = await Promise.all([
			api.getShameLeaderboard(),
			api.getUsers(),
		]);
		if (lbResult.ok) setLeaderboard(lbResult.data);
		if (usersResult.ok) setUsers(usersResult.data);
		setLoading(false);
	};

	const handleShame = async (targetId: string) => {
		setError('');
		const reason = reasons[targetId]?.trim();
		const result = await api.shameUser(targetId, reason || undefined);
		if (result.ok) {
			setReasons((prev) => ({ ...prev, [targetId]: '' }));
			setExpandedTarget(null);
			fetchData();
		} else {
			setError(result.error.message);
		}
	};

	if (loading) return <div class="spinner" style={{ margin: '20px auto' }} />;

	// Get users with shame counts, including 0-shame users
	const shamedIds = new Set(leaderboard.map((e: any) => e.user_id));
	const shamableUsers = users.filter((u) => u.id !== userId && !shamedIds.has(u.id));

	return (
		<div>
			<h2 style={{ marginBottom: '8px' }}>Shame Wall</h2>
			<p style={{ marginBottom: '20px', fontSize: '13px', color: 'var(--text-muted)' }}>
				Shame a friend who no-showed, went AFK, or dodged. Once per person per day.
			</p>

			{error && <p style={{ color: 'var(--danger)', fontSize: '13px', marginBottom: '12px' }}>{error}</p>}

			{/* Leaderboard */}
			{leaderboard.length > 0 && (
				<div style={{ marginBottom: '24px' }}>
					<h3 style={{ marginBottom: '12px', fontSize: '16px', color: 'var(--text-secondary)' }}>Hall of Shame</h3>
					<div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: '480px', width: '100%' }}>
						{leaderboard.map((entry: any, i: number) => (
							<div key={entry.user_id}>
								<div
									class="card"
									style={{
										display: 'flex',
										alignItems: 'center',
										gap: '12px',
										padding: '12px 16px',
									}}
								>
									<span
										style={{
											fontSize: '20px',
											fontWeight: 700,
											color: i === 0 ? 'var(--shame)' : 'var(--text-muted)',
											minWidth: '30px',
										}}
									>
										#{i + 1}
									</span>
									{entry.avatar_url && (
										<img
											src={entry.avatar_url}
											alt={entry.discord_username}
											style={{ width: '28px', height: '28px', borderRadius: '50%' }}
										/>
									)}
									<div style={{ flex: 1 }}>
										<span style={{ fontWeight: 500 }}>{entry.discord_username}</span>
										{entry.recent_reasons?.length > 0 && (
											<div style={{ marginTop: '4px' }}>
												{entry.recent_reasons.map((r: string, j: number) => (
													<span key={j} style={{ fontSize: '11px', color: 'var(--text-muted)', display: 'block' }}>
														"{r}"
													</span>
												))}
											</div>
										)}
									</div>
									<span class="badge badge-danger">{entry.shame_count} shames</span>
									{entry.user_id !== userId && (
										<button
											class="btn btn-secondary"
											style={{ padding: '2px 8px', fontSize: '11px' }}
											onClick={() => setExpandedTarget(expandedTarget === entry.user_id ? null : entry.user_id)}
										>
											Shame
										</button>
									)}
								</div>
								{expandedTarget === entry.user_id && (
									<div style={{ display: 'flex', gap: '8px', padding: '8px 16px' }}>
										<input
											type="text"
											placeholder="Reason (optional)"
											value={reasons[entry.user_id] || ''}
											onInput={(e) =>
												setReasons((prev) => ({ ...prev, [entry.user_id]: (e.target as HTMLInputElement).value }))
											}
											style={{ flex: 1, fontSize: '13px', padding: '4px 8px' }}
											maxLength={200}
										/>
										<button class="btn btn-danger" style={{ padding: '4px 10px', fontSize: '12px' }} onClick={() => handleShame(entry.user_id)}>
											Confirm
										</button>
									</div>
								)}
							</div>
						))}
					</div>
				</div>
			)}

			{/* Shame someone new */}
			{shamableUsers.length > 0 && (
				<div>
					<h3 style={{ marginBottom: '12px', fontSize: '16px', color: 'var(--text-secondary)' }}>Shame Someone</h3>
					<div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: '480px', width: '100%' }}>
						{shamableUsers.map((u) => (
							<div key={u.id}>
								<div
									class="card"
									style={{
										display: 'flex',
										alignItems: 'center',
										gap: '12px',
										padding: '10px 16px',
									}}
								>
									{u.avatar_url && (
										<img
											src={u.avatar_url}
											alt={u.discord_username}
											style={{ width: '28px', height: '28px', borderRadius: '50%' }}
										/>
									)}
									<span style={{ flex: 1, fontWeight: 500 }}>{u.discord_username}</span>
									<button
										class="btn btn-secondary"
										style={{ padding: '2px 8px', fontSize: '11px' }}
										onClick={() => setExpandedTarget(expandedTarget === u.id ? null : u.id)}
									>
										Shame
									</button>
								</div>
								{expandedTarget === u.id && (
									<div style={{ display: 'flex', gap: '8px', padding: '8px 16px' }}>
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
										<button class="btn btn-danger" style={{ padding: '4px 10px', fontSize: '12px' }} onClick={() => handleShame(u.id)}>
											Confirm
										</button>
									</div>
								)}
							</div>
						))}
					</div>
				</div>
			)}

			{leaderboard.length === 0 && shamableUsers.length === 0 && (
				<p class="text-muted" style={{ textAlign: 'center', padding: '40px' }}>
					No one has been shamed yet. How noble.
				</p>
			)}
		</div>
	);
}
