import { useState, useRef, useEffect } from 'preact/hooks';
import { api } from '../../api/client';

interface ProposeGameFormProps {
	onSubmit: () => void;
}

export function ProposeGameForm({ onSubmit }: ProposeGameFormProps) {
	const [mode, setMode] = useState<'search' | 'appid' | 'manual'>('search');
	const [searchQuery, setSearchQuery] = useState('');
	const [searchResults, setSearchResults] = useState<Array<{ app_id: string; name: string; image_url: string }>>([]);
	const [steamAppId, setSteamAppId] = useState('');
	const [name, setName] = useState('');
	const [imageUrl, setImageUrl] = useState('');
	const [loading, setLoading] = useState(false);
	const [searching, setSearching] = useState(false);
	const [error, setError] = useState('');
	const debounceRef = useRef<ReturnType<typeof setTimeout>>();

	// Debounced Steam search
	useEffect(() => {
		if (mode !== 'search' || searchQuery.length < 2) {
			setSearchResults([]);
			return;
		}

		if (debounceRef.current) clearTimeout(debounceRef.current);
		debounceRef.current = setTimeout(async () => {
			setSearching(true);
			const result = await api.searchSteam(searchQuery);
			if (result.ok) setSearchResults(result.data);
			setSearching(false);
		}, 300);

		return () => {
			if (debounceRef.current) clearTimeout(debounceRef.current);
		};
	}, [searchQuery, mode]);

	const selectSearchResult = (result: { app_id: string; name: string; image_url: string }) => {
		setSteamAppId(result.app_id);
		setName(result.name);
		setImageUrl(result.image_url);
		setSearchResults([]);
		setSearchQuery('');
	};

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

			<div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
				<button
					class={`btn ${mode === 'search' ? 'btn-primary' : 'btn-secondary'}`}
					style={{ padding: '4px 12px', fontSize: '12px' }}
					onClick={() => setMode('search')}
				>
					Search Steam
				</button>
				<button
					class={`btn ${mode === 'appid' ? 'btn-primary' : 'btn-secondary'}`}
					style={{ padding: '4px 12px', fontSize: '12px' }}
					onClick={() => setMode('appid')}
				>
					App ID
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
				{mode === 'search' && (
					<div style={{ position: 'relative' }}>
						<input
							type="text"
							placeholder="Search for a game..."
							value={searchQuery}
							onInput={(e) => setSearchQuery((e.target as HTMLInputElement).value)}
							style={{ width: '100%' }}
						/>
						{searching && (
							<span class="text-muted" style={{ fontSize: '12px', marginTop: '4px', display: 'block' }}>
								Searching...
							</span>
						)}
						{searchResults.length > 0 && (
							<div style={{
								position: 'absolute',
								top: '100%',
								left: 0,
								right: 0,
								background: 'var(--bg-card)',
								border: '1px solid var(--border)',
								borderRadius: 'var(--radius)',
								zIndex: 50,
								maxHeight: '300px',
								overflow: 'auto',
							}}>
								{searchResults.map((r) => (
									<button
										key={r.app_id}
										type="button"
										onClick={() => selectSearchResult(r)}
										style={{
											display: 'flex',
											alignItems: 'center',
											gap: '10px',
											width: '100%',
											padding: '8px 12px',
											background: 'transparent',
											color: 'var(--text-primary)',
											textAlign: 'left',
											borderBottom: '1px solid var(--border)',
											cursor: 'pointer',
										}}
									>
										{r.image_url && (
											<img
												src={r.image_url}
												alt={r.name}
												style={{ width: '40px', height: '18px', objectFit: 'cover', borderRadius: '2px' }}
											/>
										)}
										<span style={{ fontSize: '13px' }}>{r.name}</span>
									</button>
								))}
							</div>
						)}
					</div>
				)}

				{mode === 'appid' && (
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
