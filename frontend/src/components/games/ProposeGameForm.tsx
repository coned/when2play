import { useState } from 'preact/hooks';
import { api } from '../../api/client';

interface ProposeGameFormProps {
	onSubmit: () => void;
}

export function ProposeGameForm({ onSubmit }: ProposeGameFormProps) {
	const [mode, setMode] = useState<'steam' | 'manual'>('steam');
	const [steamAppId, setSteamAppId] = useState('');
	const [name, setName] = useState('');
	const [imageUrl, setImageUrl] = useState('');
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState('');

	const handleSteamLookup = async () => {
		if (!steamAppId) return;
		setLoading(true);
		setError('');

		const result = await api.lookupSteam(steamAppId);
		if (result.ok) {
			setName(result.data.name);
			setImageUrl(result.data.header_image);
		} else {
			setError('Steam app not found. Try manual entry.');
		}
		setLoading(false);
	};

	const handleSubmit = async (e: Event) => {
		e.preventDefault();
		if (!name) return;
		setLoading(true);

		const result = await api.createGame({
			name,
			steam_app_id: steamAppId || undefined,
			image_url: imageUrl || undefined,
		});

		if (result.ok) {
			onSubmit();
		} else {
			setError('Failed to create game');
		}
		setLoading(false);
	};

	return (
		<div class="card" style={{ marginBottom: '20px' }}>
			<h3 style={{ marginBottom: '12px' }}>Propose a Game</h3>

			<div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
				<button
					class={`btn ${mode === 'steam' ? 'btn-primary' : 'btn-secondary'}`}
					style={{ padding: '4px 12px', fontSize: '12px' }}
					onClick={() => setMode('steam')}
				>
					Steam Lookup
				</button>
				<button
					class={`btn ${mode === 'manual' ? 'btn-primary' : 'btn-secondary'}`}
					style={{ padding: '4px 12px', fontSize: '12px' }}
					onClick={() => setMode('manual')}
				>
					Manual Entry
				</button>
			</div>

			<form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
				{mode === 'steam' && (
					<div style={{ display: 'flex', gap: '8px' }}>
						<input
							type="text"
							placeholder="Steam App ID (e.g. 730)"
							value={steamAppId}
							onInput={(e) => setSteamAppId((e.target as HTMLInputElement).value)}
							style={{ flex: 1 }}
						/>
						<button type="button" class="btn btn-secondary" onClick={handleSteamLookup} disabled={loading}>
							Lookup
						</button>
					</div>
				)}

				<input
					type="text"
					placeholder="Game name"
					value={name}
					onInput={(e) => setName((e.target as HTMLInputElement).value)}
					required
				/>

				{imageUrl && (
					<img src={imageUrl} alt="Preview" style={{ maxWidth: '200px', borderRadius: 'var(--radius)' }} />
				)}

				{error && <p style={{ color: 'var(--danger)', fontSize: '13px' }}>{error}</p>}

				<button type="submit" class="btn btn-primary" disabled={loading || !name}>
					{loading ? 'Saving...' : 'Propose'}
				</button>
			</form>
		</div>
	);
}
