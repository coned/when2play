import { useState } from 'preact/hooks';
import { api } from '../../api/client';

interface ReactionUser {
	user_id: string;
	type: 'like' | 'dislike';
	display_name: string | null;
	avatar_url: string | null;
}

interface GameCardProps {
	game: any;
	onUpdate: () => void;
	userReaction: 'like' | 'dislike' | null;
	likeCount: number;
	dislikeCount: number;
	reactionUsers: ReactionUser[];
	currentUser: { id: string; display_name: string | null; avatar_url: string | null; discord_username: string };
	isArchived?: boolean;
}

function AvatarStack({ users, maxShow = 4 }: { users: ReactionUser[]; maxShow?: number }) {
	if (users.length === 0) return null;
	const shown = users.slice(0, maxShow);
	const overflow = users.length - shown.length;
	return (
		<div style={{ display: 'flex', alignItems: 'center' }}>
			{shown.map((u, i) =>
				u.avatar_url ? (
					<img
						key={u.user_id}
						src={u.avatar_url}
						alt={u.display_name ?? ''}
						title={u.display_name ?? ''}
						style={{
							width: '20px',
							height: '20px',
							borderRadius: '50%',
							border: '1.5px solid var(--bg-card)',
							marginLeft: i > 0 ? '-6px' : 0,
							flexShrink: 0,
						}}
					/>
				) : (
					<span
						key={u.user_id}
						title={u.display_name ?? ''}
						style={{
							width: '20px',
							height: '20px',
							borderRadius: '50%',
							background: 'var(--accent)',
							border: '1.5px solid var(--bg-card)',
							marginLeft: i > 0 ? '-6px' : 0,
							display: 'flex',
							alignItems: 'center',
							justifyContent: 'center',
							fontSize: '9px',
							color: '#fff',
							flexShrink: 0,
						}}
					>
						{(u.display_name ?? '?')[0].toUpperCase()}
					</span>
				),
			)}
			{overflow > 0 && (
				<span style={{ fontSize: '10px', color: 'var(--text-muted)', marginLeft: '3px', fontWeight: 600 }}>
					+{overflow}
				</span>
			)}
		</div>
	);
}

export function GameCard({ game, onUpdate, userReaction, likeCount, dislikeCount, reactionUsers, currentUser, isArchived }: GameCardProps) {
	const [reaction, setReaction] = useState(userReaction);
	const [likes, setLikes] = useState(likeCount);
	const [dislikes, setDislikes] = useState(dislikeCount);
	const [users, setUsers] = useState<ReactionUser[]>(reactionUsers);
	const [busy, setBusy] = useState(false);

	const currentUserAsReaction = (type: 'like' | 'dislike'): ReactionUser => ({
		user_id: currentUser.id,
		type,
		display_name: currentUser.display_name ?? currentUser.discord_username,
		avatar_url: currentUser.avatar_url,
	});

	const handleReact = async (type: 'like' | 'dislike') => {
		if (busy) return;
		setBusy(true);
		if (reaction === type) {
			// Remove reaction
			if (type === 'like') setLikes((c: number) => Math.max(0, c - 1));
			else setDislikes((c: number) => Math.max(0, c - 1));
			setUsers((prev) => prev.filter((u) => u.user_id !== currentUser.id));
			setReaction(null);
			await api.removeReaction(game.id);
		} else {
			// Set or change reaction
			if (reaction === 'like') setLikes((c: number) => Math.max(0, c - 1));
			if (reaction === 'dislike') setDislikes((c: number) => Math.max(0, c - 1));
			if (type === 'like') setLikes((c: number) => c + 1);
			else setDislikes((c: number) => c + 1);
			setUsers((prev) => [
				...prev.filter((u) => u.user_id !== currentUser.id),
				currentUserAsReaction(type),
			]);
			setReaction(type);
			await api.reactToGame(game.id, type);
		}
		setBusy(false);
	};

	const handleArchive = async (reason: string) => {
		await api.archiveGame(game.id, reason);
		onUpdate();
	};

	const handleRestore = async () => {
		await api.restoreGame(game.id);
		onUpdate();
	};

	const steamUrl = game.steam_app_id ? `https://store.steampowered.com/app/${game.steam_app_id}/` : null;
	const netScore = likes - dislikes;
	const likeUsers = users.filter((u) => u.type === 'like');
	const dislikeUsers = users.filter((u) => u.type === 'dislike');

	return (
		<div class="card" style={{ overflow: 'hidden', padding: 0 }}>
			{game.image_url && (
				<div style={{ aspectRatio: '460/215', overflow: 'hidden' }}>
					<img
						src={game.image_url}
						alt={game.name}
						style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
					/>
				</div>
			)}
			<div style={{ padding: '10px 14px' }}>
				{/* Name + Steam link */}
				<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
					<h3 style={{ fontSize: '15px', fontWeight: 600, margin: 0, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
						{game.name}
					</h3>
					{steamUrl && (
						<a
							href={steamUrl}
							target="_blank"
							rel="noopener"
							class="badge badge-accent"
							style={{ textDecoration: 'none', cursor: 'pointer', flexShrink: 0, fontSize: '10px' }}
						>
							Steam
						</a>
					)}
				</div>

				{/* Reaction buttons + score */}
				<div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
					<button
						onClick={() => handleReact('like')}
						disabled={busy}
						style={{
							display: 'flex',
							alignItems: 'center',
							gap: '3px',
							background: 'transparent',
							border: reaction === 'like' ? '1.5px solid #e74c4c' : '1px solid var(--border)',
							color: reaction === 'like' ? '#e74c4c' : 'var(--text-muted)',
							cursor: 'pointer',
							padding: '4px 8px',
							borderRadius: 'var(--radius)',
							fontSize: '13px',
							minHeight: '32px',
						}}
						title="Like"
					>
						<span style={{ fontSize: '14px' }}>{reaction === 'like' ? '\u2764\uFE0F' : '\u2661'}</span>
						{likes > 0 && <span>{likes}</span>}
					</button>

					<button
						onClick={() => handleReact('dislike')}
						disabled={busy}
						style={{
							display: 'flex',
							alignItems: 'center',
							gap: '3px',
							background: 'transparent',
							border: reaction === 'dislike' ? '1.5px solid var(--danger)' : '1px solid var(--border)',
							color: reaction === 'dislike' ? 'var(--danger)' : 'var(--text-muted)',
							cursor: 'pointer',
							padding: '4px 8px',
							borderRadius: 'var(--radius)',
							fontSize: '13px',
							minHeight: '32px',
						}}
						title="Dislike"
					>
						<span style={{ fontSize: '14px' }}>&#x1F44E;</span>
						{dislikes > 0 && <span>{dislikes}</span>}
					</button>

					{(likes > 0 || dislikes > 0) && (
						<span style={{
							fontSize: '13px',
							fontWeight: 600,
							color: netScore > 0 ? 'var(--success)' : netScore < 0 ? 'var(--danger)' : 'var(--text-muted)',
							marginLeft: '2px',
						}}>
							{netScore > 0 ? `+${netScore}` : netScore}
						</span>
					)}
				</div>

				{/* Reaction user avatars */}
				{(likeUsers.length > 0 || dislikeUsers.length > 0) && (
					<div style={{ display: 'flex', gap: '10px', marginBottom: '8px', alignItems: 'center' }}>
						{likeUsers.length > 0 && (
							<div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
								<span style={{ fontSize: '11px', color: '#e74c4c' }}>{'\u2764\uFE0F'}</span>
								<AvatarStack users={likeUsers} />
							</div>
						)}
						{dislikeUsers.length > 0 && (
							<div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
								<span style={{ fontSize: '11px', color: 'var(--danger)' }}>&#x1F44E;</span>
								<AvatarStack users={dislikeUsers} />
							</div>
						)}
					</div>
				)}

				{/* Archive / Restore buttons */}
				{isArchived ? (
					<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
						{game.archived_at && (
							<span class="text-muted" style={{ fontSize: '11px' }}>
								{new Date(game.archived_at).toLocaleDateString()}
							</span>
						)}
						<button
							class="btn btn-secondary"
							style={{ padding: '4px 10px', fontSize: '12px' }}
							onClick={handleRestore}
						>
							Restore
						</button>
					</div>
				) : (
					<div style={{ display: 'flex', gap: '6px' }}>
						<button
							style={{
								padding: '4px 10px',
								fontSize: '11px',
								flex: 1,
								cursor: 'pointer',
								borderRadius: 'var(--radius)',
								border: '1px solid var(--warning)',
								background: 'rgba(234, 179, 8, 0.12)',
								color: 'var(--warning)',
								fontWeight: 600,
							}}
							onClick={() => handleArchive('save_for_later')}
						>
							Save for later
						</button>
						<button
							class="btn btn-danger"
							style={{ padding: '4px 10px', fontSize: '11px' }}
							onClick={() => handleArchive('not_interested')}
						>
							Delete
						</button>
					</div>
				)}
			</div>
		</div>
	);
}
