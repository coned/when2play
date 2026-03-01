import { useState, useEffect } from 'preact/hooks';
import { api } from '../../api/client';

export function GameRanking() {
	const [ranking, setRanking] = useState<any[]>([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		(async () => {
			const result = await api.getGameRanking();
			if (result.ok) setRanking(result.data);
			setLoading(false);
		})();
	}, []);

	if (loading) return <div class="spinner" style={{ margin: '20px auto' }} />;
	if (ranking.length === 0) return null;

	return (
		<div>
			<h3 style={{ marginBottom: '12px' }}>Suggestion for Today</h3>
			<div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
				{ranking.map((item, i) => {
					const steamUrl = item.steam_app_id
						? `https://store.steampowered.com/app/${item.steam_app_id}/`
						: null;

					const nameEl = steamUrl ? (
						<a
							href={steamUrl}
							target="_blank"
							rel="noopener"
							style={{ flex: 1, fontWeight: 500, color: 'var(--text-primary)', textDecoration: 'none' }}
						>
							{item.name}
						</a>
					) : (
						<span style={{ flex: 1, fontWeight: 500 }}>{item.name}</span>
					);

					return (
						<div
							key={item.game_id}
							class="card"
							style={{
								display: 'flex',
								alignItems: 'center',
								gap: '12px',
								padding: '10px 16px',
							}}
						>
							<span style={{ fontSize: '20px', fontWeight: 700, color: 'var(--accent)', minWidth: '30px' }}>#{i + 1}</span>
							{item.image_url && (
								<img
									src={item.image_url}
									alt={item.name}
									style={{ width: '48px', height: '22px', objectFit: 'cover', borderRadius: '4px' }}
								/>
							)}
							{nameEl}
							{item.vote_count < 2 ? (
								<span class="badge badge-warning">Needs votes</span>
							) : (
								<span class="text-secondary" style={{ fontSize: '13px', whiteSpace: 'nowrap' }}>
									{item.total_score} pts ({item.vote_count} votes{item.like_count > 0 ? `, ${item.like_count} likes` : ''})
								</span>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
}
