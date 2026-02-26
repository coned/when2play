import { useState, useEffect, useCallback } from 'preact/hooks';
import { api } from '../../api/client';
import { GameCard } from './GameCard';
import { ProposeGameForm } from './ProposeGameForm';
import { GameRanking } from './GameRanking';
import { VoteRanking } from './VoteRanking';

interface GamePoolProps {
	userId: string;
}

export function GamePool({ userId }: GamePoolProps) {
	const [games, setGames] = useState<any[]>([]);
	const [showPropose, setShowPropose] = useState(false);
	const [loading, setLoading] = useState(true);
	const [rankingKey, setRankingKey] = useState(0);

	const fetchGames = useCallback(async () => {
		setLoading(true);
		const result = await api.getGames();
		if (result.ok) setGames(result.data);
		setLoading(false);
	}, []);

	useEffect(() => {
		fetchGames();
	}, [fetchGames]);

	return (
		<div>
			<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
				<h2>Game Pool</h2>
				<button class="btn btn-primary" onClick={() => setShowPropose(!showPropose)}>
					{showPropose ? 'Cancel' : 'Propose Game'}
				</button>
			</div>

			{showPropose && (
				<ProposeGameForm
					onSubmit={() => {
						setShowPropose(false);
						fetchGames();
					}}
				/>
			)}

			{loading ? (
				<div class="spinner" style={{ margin: '20px auto' }} />
			) : games.length === 0 ? (
				<p class="text-muted" style={{ textAlign: 'center', padding: '40px' }}>
					No games proposed yet. Be the first!
				</p>
			) : (
				<>
					<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '16px', marginBottom: '32px' }}>
						{games.map((game) => (
							<GameCard key={game.id} game={game} isOwner={game.proposed_by === userId} onArchive={fetchGames} />
						))}
					</div>

					<div style={{ marginBottom: '32px' }}>
						<VoteRanking games={games} onVoteChange={() => setRankingKey((k) => k + 1)} />
					</div>

					<GameRanking key={rankingKey} />
				</>
			)}
		</div>
	);
}
