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
	// Desktop HTML5 drag state
	const [dragIndex, setDragIndex] = useState<number | null>(null);
	const [overIndex, setOverIndex] = useState<number | null>(null);
	// Mobile touch drag state
	const [touchDragIdx, setTouchDragIdx] = useState<number | null>(null);
	const [touchOverIdx, setTouchOverIdx] = useState<number | null>(null);
	const rankedListRef = useRef<HTMLDivElement>(null);
	const unrankedRef = useRef<HTMLDivElement>(null);

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

	const saveOrder = async (votes: RankedVote[]) => {
		const rankings = votes.map((v, i) => ({ game_id: v.game_id, rank: i + 1 }));
		await api.reorderVotes(rankings);
		onVoteChange();
	};

	const addToRanking = async (gameId: string) => {
		const game = games.find((g: any) => g.id === gameId);
		if (!game) return;
		const newRank = rankedVotes.length + 1;
		const result = await api.setVote(gameId, { rank: newRank });
		if (result.ok) {
			setRankedVotes((prev) => [...prev, { game_id: gameId, name: game.name, image_url: game.image_url, rank: newRank }]);
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

	// ── Desktop HTML5 drag ─────────────────────────────────────────────────

	const handleDragStart = (index: number) => setDragIndex(index);

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

	// Drop on unranked zone → remove from ranking
	const handleDropOnUnranked = async (e: DragEvent) => {
		e.preventDefault();
		if (dragIndex !== null) {
			await removeFromRanking(rankedVotes[dragIndex].game_id);
		}
		setDragIndex(null);
		setOverIndex(null);
	};

	// ── Mobile touch drag ──────────────────────────────────────────────────

	const handleTouchStart = (e: TouchEvent, index: number) => {
		e.preventDefault();
		setTouchDragIdx(index);
		setTouchOverIdx(index);
	};

	const handleContainerTouchMove = (e: TouchEvent) => {
		if (touchDragIdx === null) return;
		e.preventDefault();
		const touch = e.touches[0];
		const el = document.elementFromPoint(touch.clientX, touch.clientY);
		const attr = (el as HTMLElement | null)?.closest('[data-rank-idx]')?.getAttribute('data-rank-idx');
		setTouchOverIdx(attr != null ? parseInt(attr) : null);
	};

	const handleContainerTouchEnd = async (e: TouchEvent) => {
		if (touchDragIdx === null) return;
		const touch = e.changedTouches[0];
		const el = document.elementFromPoint(touch.clientX, touch.clientY);
		const attr = (el as HTMLElement | null)?.closest('[data-rank-idx]')?.getAttribute('data-rank-idx');

		if (attr != null) {
			const toIdx = parseInt(attr);
			if (toIdx !== touchDragIdx) {
				const newVotes = [...rankedVotes];
				const [item] = newVotes.splice(touchDragIdx, 1);
				newVotes.splice(toIdx, 0, item);
				setRankedVotes(newVotes);
				await saveOrder(newVotes);
			}
		} else if (unrankedRef.current) {
			const rect = unrankedRef.current.getBoundingClientRect();
			if (touch.clientY >= rect.top - 50) {
				await removeFromRanking(rankedVotes[touchDragIdx].game_id);
			}
		}

		setTouchDragIdx(null);
		setTouchOverIdx(null);
	};

	if (loading) return <div class="spinner" style={{ margin: '20px auto' }} />;

	const rankedGameIds = new Set(rankedVotes.map((v) => v.game_id));
	const unrankedGames = games.filter((g: any) => !rankedGameIds.has(g.id) && !g.is_archived);
	const isDraggingAny = dragIndex !== null || touchDragIdx !== null;

	return (
		<div>
			<h3 style={{ marginBottom: '8px' }}>Vote for what to play today</h3>
			<p style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '12px' }}>
				{rankedVotes.length === 0 ? 'Add games below to cast your vote.' : 'Drag to reorder · drag to the zone below to unrank'}
			</p>

			{/* Ranked list */}
			<div
				ref={rankedListRef}
				onTouchMove={handleContainerTouchMove}
				onTouchEnd={handleContainerTouchEnd}
				style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '12px', touchAction: 'none' }}
			>
				{rankedVotes.map((vote, i) => {
					const isTouchActive = touchDragIdx === i;
					const isTouchOver = touchOverIdx === i && touchDragIdx !== null && touchDragIdx !== i;

					return (
						<div
							key={vote.game_id}
							data-rank-idx={i}
							draggable
							onDragStart={() => handleDragStart(i)}
							onDragOver={(e) => handleDragOver(e as DragEvent, i)}
							onDrop={() => handleDrop(i)}
							onDragEnd={handleDragEnd}
							onTouchStart={(e) => handleTouchStart(e as TouchEvent, i)}
							class="card"
							style={{
								display: 'flex',
								alignItems: 'center',
								gap: '10px',
								padding: '8px 12px',
								cursor: 'grab',
								opacity: dragIndex === i || isTouchActive ? 0.4 : 1,
								borderColor: overIndex === i || isTouchOver ? 'var(--accent)' : undefined,
								transition: 'opacity 0.1s',
							}}
						>
							<span style={{ color: 'var(--text-muted)', fontSize: '18px', lineHeight: 1 }}>&#x2261;</span>
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
					);
				})}
			</div>

			{/* Unranked zone — desktop drop target + touch drop zone */}
			<div
				ref={unrankedRef}
				onDragOver={(e) => (e as DragEvent).preventDefault()}
				onDrop={handleDropOnUnranked}
				style={{
					borderTop: isDraggingAny ? '2px dashed var(--accent)' : '1px solid var(--border)',
					paddingTop: '10px',
					marginTop: '4px',
					minHeight: unrankedGames.length === 0 && isDraggingAny ? '48px' : undefined,
					borderRadius: isDraggingAny ? '4px' : undefined,
					background: isDraggingAny ? 'var(--bg-secondary)' : undefined,
					transition: 'all 0.15s',
				}}
			>
				{unrankedGames.length > 0 && (
					<h4 style={{ fontSize: '13px', color: isDraggingAny ? 'var(--accent)' : 'var(--text-secondary)', marginBottom: '8px' }}>
						{isDraggingAny ? '↓ Drop here to unrank' : 'Unranked Games'}
					</h4>
				)}
				{isDraggingAny && unrankedGames.length === 0 && (
					<p style={{ fontSize: '13px', color: 'var(--accent)', textAlign: 'center' }}>↓ Drop here to unrank</p>
				)}
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
		</div>
	);
}
