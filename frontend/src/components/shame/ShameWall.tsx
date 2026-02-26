import { useState, useEffect } from 'preact/hooks';
import { api } from '../../api/client';

interface ShameWallProps {
	userId: string;
}

export function ShameWall({ userId }: ShameWallProps) {
	const [leaderboard, setLeaderboard] = useState<any[]>([]);
	const [loading, setLoading] = useState(true);
	const [shameTarget, setShameTarget] = useState('');
	const [reason, setReason] = useState('');
	const [error, setError] = useState('');

	useEffect(() => {
		fetchLeaderboard();
	}, []);

	const fetchLeaderboard = async () => {
		setLoading(true);
		const result = await api.getShameLeaderboard();
		if (result.ok) setLeaderboard(result.data);
		setLoading(false);
	};

	const handleShame = async (targetId: string) => {
		setError('');
		const result = await api.shameUser(targetId, reason || undefined);
		if (result.ok) {
			setReason('');
			fetchLeaderboard();
		} else {
			setError(result.error.message);
		}
	};

	return (
		<div>
			<h2 style={{ marginBottom: '20px' }}>Shame Wall</h2>

			{loading ? (
				<div class="spinner" style={{ margin: '20px auto' }} />
			) : leaderboard.length === 0 ? (
				<p class="text-muted" style={{ textAlign: 'center', padding: '40px' }}>
					No one has been shamed yet. How noble.
				</p>
			) : (
				<div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: '480px', width: '100%' }}>
					{leaderboard.map((entry, i) => (
						<div
							key={entry.user_id}
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
							<span style={{ flex: 1, fontWeight: 500 }}>{entry.discord_username}</span>
							<span class="badge badge-danger">{entry.shame_count} shames</span>
							{entry.user_id !== userId && (
								<button
									class="btn btn-secondary"
									style={{ padding: '2px 8px', fontSize: '11px' }}
									onClick={() => handleShame(entry.user_id)}
								>
									Shame
								</button>
							)}
						</div>
					))}
				</div>
			)}

			{error && <p style={{ color: 'var(--danger)', fontSize: '13px', marginTop: '8px' }}>{error}</p>}
		</div>
	);
}
