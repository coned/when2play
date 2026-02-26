import { api } from '../../api/client';

interface GameCardProps {
	game: any;
	isOwner: boolean;
	onArchive: () => void;
}

export function GameCard({ game, isOwner, onArchive }: GameCardProps) {
	const handleArchive = async () => {
		await api.archiveGame(game.id);
		onArchive();
	};

	return (
		<div class="card" style={{ overflow: 'hidden', padding: 0 }}>
			{game.image_url && (
				<img
					src={game.image_url}
					alt={game.name}
					style={{ width: '100%', height: '130px', objectFit: 'cover', display: 'block' }}
				/>
			)}
			<div style={{ padding: '12px 16px' }}>
				<div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
					<h3 style={{ fontSize: '16px', fontWeight: 600 }}>{game.name}</h3>
					{game.steam_app_id && <span class="badge badge-accent">Steam</span>}
				</div>
				{isOwner && (
					<button class="btn btn-secondary" style={{ marginTop: '8px', padding: '4px 10px', fontSize: '12px' }} onClick={handleArchive}>
						Archive
					</button>
				)}
			</div>
		</div>
	);
}
