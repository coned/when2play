import { useState } from 'preact/hooks';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { api } from '../../api/client';
import { avatarInitial } from '../../lib/initials';

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
							color: 'var(--on-accent)',
							flexShrink: 0,
						}}
					>
						{avatarInitial(u.display_name)}
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
	const isMobile = useMediaQuery(768);
	const [reaction, setReaction] = useState(userReaction);
	const [likes, setLikes] = useState(likeCount);
	const [dislikes, setDislikes] = useState(dislikeCount);
	const [users, setUsers] = useState<ReactionUser[]>(reactionUsers);
	const [busy, setBusy] = useState(false);
	/** Last failed action on this card; cleared when the next one starts */
	const [actionError, setActionError] = useState('');
	/** Permanent deletion waits for a second, confirming click */
	const [confirmingDelete, setConfirmingDelete] = useState(false);

	const isProposer = !!game.proposed_by && game.proposed_by === currentUser.id;

	const currentUserAsReaction = (type: 'like' | 'dislike'): ReactionUser => ({
		user_id: currentUser.id,
		type,
		display_name: currentUser.display_name ?? currentUser.discord_username,
		avatar_url: currentUser.avatar_url,
	});

	/** Run one card action; on failure show its message on the card. Returns whether it worked. */
	const run = async (failure: string, request: () => Promise<{ ok: boolean; error?: { message?: string } }>): Promise<boolean> => {
		if (busy) return false;
		setBusy(true);
		setActionError('');
		const result = await request();
		setBusy(false);
		if (!result.ok) {
			setActionError(result.error?.message ? `${failure}: ${result.error.message}` : `${failure}.`);
			return false;
		}
		return true;
	};

	const handleReact = async (type: 'like' | 'dislike') => {
		if (busy) return;
		// Optimistic update, rolled back if the request fails
		const before = { reaction, likes, dislikes, users };
		const removing = reaction === type;
		if (removing) {
			if (type === 'like') setLikes(Math.max(0, likes - 1));
			else setDislikes(Math.max(0, dislikes - 1));
			setUsers(users.filter((u) => u.user_id !== currentUser.id));
			setReaction(null);
		} else {
			let l = likes;
			let d = dislikes;
			if (reaction === 'like') l = Math.max(0, l - 1);
			if (reaction === 'dislike') d = Math.max(0, d - 1);
			if (type === 'like') l += 1;
			else d += 1;
			setLikes(l);
			setDislikes(d);
			setUsers([...users.filter((u) => u.user_id !== currentUser.id), currentUserAsReaction(type)]);
			setReaction(type);
		}
		const ok = await run(
			removing ? 'Could not remove your reaction' : `Could not save your ${type}`,
			() => (removing ? api.removeReaction(game.id) : api.reactToGame(game.id, type)),
		);
		if (!ok) {
			setReaction(before.reaction);
			setLikes(before.likes);
			setDislikes(before.dislikes);
			setUsers(before.users);
		}
	};

	const handleArchive = async (reason: 'save_for_later' | 'not_interested') => {
		const failure = reason === 'save_for_later' ? 'Could not save it for later' : 'Could not delete it';
		if (await run(failure, () => api.archiveGame(game.id, reason))) onUpdate();
	};

	const handleRestore = async () => {
		if (await run('Could not restore it', () => api.restoreGame(game.id))) onUpdate();
	};

	const handleDeletePermanently = async () => {
		const ok = await run('Could not delete it forever', () => api.deleteGamePermanently(game.id));
		setConfirmingDelete(false);
		if (ok) onUpdate();
	};

	const [sharing, setSharing] = useState(false);
	const [shareMsg, setShareMsg] = useState('');
	const handleShare = async () => {
		setSharing(true);
		setShareMsg('');
		setActionError('');
		const result = await api.shareGame(game.id);
		if (!result.ok) {
			setShareMsg(result.error?.code === 'RATE_LIMITED' ? 'Wait a moment' : 'Failed');
			setActionError(`Could not share it: ${result.error.message}`);
		} else if (result.data?.bot_online === false) setShareMsg('Queued, bot looks offline');
		else setShareMsg('Shared!');
		setSharing(false);
		setTimeout(() => setShareMsg(''), result.ok && result.data?.bot_online === false ? 6000 : 3000);
	};

	const steamUrl = game.steam_app_id ? `https://store.steampowered.com/app/${game.steam_app_id}/` : null;
	const netScore = likes - dislikes;
	const likeUsers = users.filter((u) => u.type === 'like');
	const dislikeUsers = users.filter((u) => u.type === 'dislike');

	return (
		<article class="card" aria-label={game.name} style={{ overflow: 'hidden', padding: 0 }}>
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

				{/* Note */}
				{game.note && (
					<p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: '0 0 8px 0', lineHeight: 1.4 }}>
						{game.note}
					</p>
				)}

				{/* Reaction buttons + score */}
				<div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
					<button
						class="touch-target"
						onClick={() => handleReact('like')}
						disabled={busy}
						aria-pressed={reaction === 'like'}
						aria-label={likes > 0 ? `Like, ${likes}` : 'Like'}
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
							minHeight: isMobile ? '44px' : '32px',
							minWidth: isMobile ? '44px' : undefined,
							justifyContent: 'center',
						}}
						title="Like"
					>
						<span aria-hidden="true" style={{ fontSize: '14px' }}>{reaction === 'like' ? '\u2764\uFE0F' : '\u2661'}</span>
						{likes > 0 && <span>{likes}</span>}
					</button>

					<button
						class="touch-target"
						onClick={() => handleReact('dislike')}
						disabled={busy}
						aria-pressed={reaction === 'dislike'}
						aria-label={dislikes > 0 ? `Dislike, ${dislikes}` : 'Dislike'}
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
							minHeight: isMobile ? '44px' : '32px',
							minWidth: isMobile ? '44px' : undefined,
							justifyContent: 'center',
						}}
						title="Dislike"
					>
						<span aria-hidden="true" style={{ fontSize: '14px' }}>&#x1F44E;</span>
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

				{/* Archive / Restore / Share buttons */}
				{isArchived ? (
					<div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
						<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
							{game.archived_at && (
								<span class="text-muted" style={{ fontSize: '11px' }}>
									{new Date(game.archived_at).toLocaleDateString()}
								</span>
							)}
							<div style={{ display: 'flex', gap: '6px', marginLeft: 'auto' }}>
								<button
									type="button"
									class="btn btn-secondary"
									style={{ padding: '4px 10px', fontSize: '12px' }}
									onClick={handleRestore}
									disabled={busy}
								>
									Restore
								</button>
								{/* Only the proposer may delete for good (the server refuses anyone else) */}
								{isProposer && !confirmingDelete && (
									<button
										type="button"
										class="btn btn-danger"
										style={{ padding: '4px 10px', fontSize: '12px' }}
										onClick={() => {
											setActionError('');
											setConfirmingDelete(true);
										}}
										disabled={busy}
									>
										Delete forever
									</button>
								)}
							</div>
						</div>
						{isProposer && confirmingDelete && (
							<div
								role="group"
								aria-label="Confirm permanent deletion"
								style={{
									display: 'flex',
									flexWrap: 'wrap',
									alignItems: 'center',
									gap: '6px',
									padding: '8px',
									border: '1px solid var(--danger)',
									borderRadius: 'var(--radius)',
								}}
							>
								<span style={{ fontSize: '12px', color: 'var(--text-primary)', flex: '1 1 140px' }}>
									Delete {game.name} for good? This cannot be undone.
								</span>
								<button
									type="button"
									class="btn btn-danger"
									style={{ padding: '4px 10px', fontSize: '12px' }}
									onClick={handleDeletePermanently}
									disabled={busy}
								>
									Yes, delete forever
								</button>
								<button
									type="button"
									class="btn btn-secondary"
									style={{ padding: '4px 10px', fontSize: '12px' }}
									onClick={() => setConfirmingDelete(false)}
									disabled={busy}
								>
									Cancel
								</button>
							</div>
						)}
					</div>
				) : (
					<div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
						<button
							type="button"
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
							disabled={busy}
						>
							Save for later
						</button>
						<button
							type="button"
							class="btn btn-danger"
							style={{ padding: '4px 10px', fontSize: '11px' }}
							onClick={() => handleArchive('not_interested')}
							disabled={busy}
							title="Move to the archive (can be restored)"
						>
							Delete
						</button>
						<button
							type="button"
							class="btn btn-secondary"
							style={{ padding: '4px 10px', fontSize: '11px' }}
							onClick={handleShare}
							disabled={sharing}
							title="Broadcast to Discord"
							aria-label={sharing ? 'Sharing to Discord' : shareMsg ? `Share to Discord: ${shareMsg}` : 'Share to Discord'}
						>
							{sharing ? '...' : shareMsg || 'Share'}
						</button>
					</div>
				)}

				{actionError && (
					<p role="alert" style={{ color: 'var(--danger)', fontSize: '12px', marginTop: '6px' }}>
						{actionError}
					</p>
				)}
			</div>
		</article>
	);
}
