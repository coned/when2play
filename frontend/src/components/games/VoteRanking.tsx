import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import { api } from '../../api/client';

interface VoteRankingProps {
	games: any[];
	onVoteChange: () => void;
}

interface RankedVote {
	game_id: string;
	name: string;
	image_url: string | null;
	rank: number;
}

export function VoteRanking({ games, onVoteChange }: VoteRankingProps) {
	const [rankedVotes, setRankedVotes] = useState<RankedVote[]>([]);
	const [loading, setLoading] = useState(true);
	const [dragIndex, setDragIndex] = useState<number | null>(null);
	const [overIndex, setOverIndex] = useState<number | null>(null);
	const listRef = useRef<HTMLDivElement>(null);

	const fetchMyVotes = useCallback(async () => {
		const result = await api.getMyVotes();
		if (result.ok) {
			setRankedVotes(
				result.data.map((v: any) => ({
					game_id: v.game_id,
					name: v.name,
					image_url: v.image_url,
					rank: v.rank,
				})),
			);
		}
		setLoading(false);
	}, []);

	useEffect(() => {
		fetchMyVotes();
	}, [fetchMyVotes]);

	const moveItem = (from: number, to: number) => {
		setRankedVotes((prev) => {
			const next = [...prev];
			const [item] = next.splice(from, 1);
			next.splice(to, 0, item);
			return next;
		});
	};

	const saveOrder = async (votes: RankedVote[]) => {
		const rankings = votes.map((v, i) => ({ game_id: v.game_id, rank: i + 1 }));
		await api.reorderVotes(rankings);
		onVoteChange();
	};

	const handleDragStart = (index: number) => {
		setDragIndex(index);
	};

	const handleDragOver = (e: DragEvent, index: number) => {
		e.preventDefault();
		setOverIndex(index);
	};

	const handleDrop = async (index: number) => {
		if (dragIndex !== null && dragIndex !== index) {
			const newVotes = [...rankedVotes];
			const [item] = newVotes.splice(dragIndex, 1);
			newVotes.splice(index, 0, item);
			setRankedVotes(newVotes);
			await saveOrder(newVotes);
		}
		setDragIndex(null);
		setOverIndex(null);
	};

	const handleDragEnd = () => {
		setDragIndex(null);
		setOverIndex(null);
	};

	const addToRanking = async (gameId: string) => {
		const game = games.find((g: any) => g.id === gameId);
		if (!game) return;

		const newRank = rankedVotes.length + 1;
		const result = await api.setVote(gameId, { rank: newRank });
		if (result.ok) {
			setRankedVotes((prev) => [
				...prev,
				{ game_id: gameId, name: game.name, image_url: game.image_url, rank: newRank },
			]);
			onVoteChange();
		}
	};

	const removeFromRanking = async (gameId: string) => {
		await api.deleteVote(gameId);
		const newVotes = rankedVotes.filter((v) => v.game_id !== gameId);
		setRankedVotes(newVotes);
		if (newVotes.length > 0) await saveOrder(newVotes);
		onVoteChange();
	};

	if (loading) return <div class="spinner" style={{ margin: '20px auto' }} />;

	const rankedGameIds = new Set(rankedVotes.map((v) => v.game_id));
	const unrankedGames = games.filter((g: any) => !rankedGameIds.has(g.id) && !g.is_archived);

	return (
		<div>
			<h3 style={{ marginBottom: '12px' }}>My Ranking</h3>

			{rankedVotes.length === 0 ? (
				<p class="text-muted" style={{ marginBottom: '16px' }}>
					Drag games to rank them. Higher = more votes.
				</p>
			) : (
				<div ref={listRef} style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '16px' }}>
					{rankedVotes.map((vote, i) => (
						<div
							key={vote.game_id}
							draggable
							onDragStart={() => handleDragStart(i)}
							onDragOver={(e) => handleDragOver(e as DragEvent, i)}
							onDrop={() => handleDrop(i)}
							onDragEnd={handleDragEnd}
							class="card"
							style={{
								display: 'flex',
								alignItems: 'center',
								gap: '10px',
								padding: '8px 12px',
								cursor: 'grab',
								opacity: dragIndex === i ? 0.5 : 1,
								borderColor: overIndex === i ? 'var(--accent)' : undefined,
							}}
						>
							<span style={{ color: 'var(--text-muted)', cursor: 'grab', fontSize: '16px' }}>&#x2261;</span>
							<span style={{ color: 'var(--accent)', fontWeight: 700, minWidth: '24px' }}>#{i + 1}</span>
							{vote.image_url && (
								<img
									src={vote.image_url}
									alt={vote.name}
									style={{ width: '36px', height: '17px', objectFit: 'cover', borderRadius: '2px' }}
								/>
							)}
							<span style={{ flex: 1, fontSize: '14px' }}>{vote.name}</span>
							<button
								class="btn btn-secondary"
								style={{ padding: '2px 8px', fontSize: '11px' }}
								onClick={() => removeFromRanking(vote.game_id)}
							>
								Remove
							</button>
						</div>
					))}
				</div>
			)}

			{unrankedGames.length > 0 && (
				<div>
					<h4 style={{ fontSize: '14px', color: 'var(--text-secondary)', marginBottom: '8px' }}>Unranked Games</h4>
					<div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
						{unrankedGames.map((game: any) => (
							<button
								key={game.id}
								class="btn btn-secondary"
								style={{ fontSize: '12px', padding: '4px 10px' }}
								onClick={() => addToRanking(game.id)}
							>
								+ {game.name}
							</button>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
