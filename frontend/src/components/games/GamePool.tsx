import { useState, useEffect, useCallback } from 'preact/hooks';
import { api } from '../../api/client';
import { GameCard } from './GameCard';
import { ProposeGameForm } from './ProposeGameForm';
import { GameRanking } from './GameRanking';
import { VoteRanking } from './VoteRanking';
import { GameActivity } from './GameActivity';

interface GamePoolProps {
	userId: string;
}

export function GamePool({ userId }: GamePoolProps) {
	const [games, setGames] = useState<any[]>([]);
	const [archivedGames, setArchivedGames] = useState<any[]>([]);
	const [showPropose, setShowPropose] = useState(false);
	const [showSaved, setShowSaved] = useState(false);
	const [showDeleted, setShowDeleted] = useState(false);
	const [loading, setLoading] = useState(true);
	const [rankingKey, setRankingKey] = useState(0);
	const [activityKey, setActivityKey] = useState(0);

	const fetchGames = useCallback(async () => {
		setLoading(true);
		const result = await api.getGames();
		if (result.ok) setGames(result.data);
		setLoading(false);
	}, []);

	const fetchArchived = useCallback(async () => {
		const result = await api.getGames(false, 'archive');
		if (result.ok) setArchivedGames(result.data);
	}, []);

	const refresh = useCallback(async () => {
		await Promise.all([fetchGames(), fetchArchived()]);
		setActivityKey((k) => k + 1);
	}, [fetchGames, fetchArchived]);

	useEffect(() => {
		fetchGames();
		fetchArchived();
	}, [fetchGames, fetchArchived]);

	const savedGames = archivedGames.filter((g) => g.archive_reason === 'save_for_later');
	const deletedGames = archivedGames.filter((g) => g.archive_reason !== 'save_for_later');

	return (
		<div>
			{/* Active Pool */}
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
						refresh();
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
							<GameCard
								key={game.id}
								game={game}
								onUpdate={refresh}
								userReaction={game.user_reaction}
								likeCount={game.like_count}
								dislikeCount={game.dislike_count}
								reactionUsers={game.reaction_users}
							/>
						))}
					</div>

					<div style={{ marginBottom: '32px' }}>
						<VoteRanking games={games} onVoteChange={() => setRankingKey((k) => k + 1)} />
					</div>

					<GameRanking key={rankingKey} />
				</>
			)}

			{/* Archive: Saved for Later */}
			<div style={{ marginTop: '32px', borderTop: '1px solid var(--border)', paddingTop: '16px' }}>
				<button
					onClick={() => setShowSaved(!showSaved)}
					style={{
						display: 'flex',
						alignItems: 'center',
						gap: '8px',
						background: 'transparent',
						border: 'none',
						color: 'var(--text-secondary)',
						cursor: 'pointer',
						fontSize: '16px',
						fontWeight: 600,
						padding: '8px 0',
						width: '100%',
						textAlign: 'left',
					}}
				>
					<span style={{ transform: showSaved ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s', display: 'inline-block' }}>
						&#x25B6;
					</span>
					Saved for Later ({savedGames.length})
				</button>

				{showSaved && savedGames.length > 0 && (
					<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '16px', marginTop: '12px' }}>
						{savedGames.map((game) => (
							<GameCard
								key={game.id}
								game={game}
								onUpdate={refresh}
								userReaction={game.user_reaction}
								likeCount={game.like_count}
								dislikeCount={game.dislike_count}
								reactionUsers={game.reaction_users}
								isArchived
							/>
						))}
					</div>
				)}
				{showSaved && savedGames.length === 0 && (
					<p class="text-muted" style={{ padding: '16px 0', fontSize: '13px' }}>No saved games.</p>
				)}
			</div>

			{/* Archive: Deleted */}
			<div style={{ borderTop: '1px solid var(--border)', paddingTop: '16px' }}>
				<button
					onClick={() => setShowDeleted(!showDeleted)}
					style={{
						display: 'flex',
						alignItems: 'center',
						gap: '8px',
						background: 'transparent',
						border: 'none',
						color: 'var(--text-secondary)',
						cursor: 'pointer',
						fontSize: '16px',
						fontWeight: 600,
						padding: '8px 0',
						width: '100%',
						textAlign: 'left',
					}}
				>
					<span style={{ transform: showDeleted ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s', display: 'inline-block' }}>
						&#x25B6;
					</span>
					Deleted ({deletedGames.length})
				</button>

				{showDeleted && deletedGames.length > 0 && (
					<div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '16px', marginTop: '12px' }}>
						{deletedGames.map((game) => (
							<GameCard
								key={game.id}
								game={game}
								onUpdate={refresh}
								userReaction={game.user_reaction}
								likeCount={game.like_count}
								dislikeCount={game.dislike_count}
								reactionUsers={game.reaction_users}
								isArchived
							/>
						))}
					</div>
				)}
				{showDeleted && deletedGames.length === 0 && (
					<p class="text-muted" style={{ padding: '16px 0', fontSize: '13px' }}>No deleted games.</p>
				)}
			</div>

			{/* Activity Feed */}
			<div style={{ marginTop: '32px', borderTop: '1px solid var(--border)', paddingTop: '16px' }}>
				<GameActivity key={activityKey} />
			</div>
		</div>
	);
}
