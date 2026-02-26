import { useState, useEffect } from 'preact/hooks';
import { api } from '../../api/client';

export function GatherBell() {
	const [message, setMessage] = useState('');
	const [isAnonymous, setIsAnonymous] = useState(false);
	const [sendTo, setSendTo] = useState<'everyone' | 'specific'>('everyone');
	const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
	const [users, setUsers] = useState<Array<{ id: string; discord_username: string; avatar_url: string | null }>>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState('');
	const [success, setSuccess] = useState(false);

	useEffect(() => {
		api.getUsers().then((r) => {
			if (r.ok) setUsers(r.data);
		});
	}, []);

	const toggleUser = (id: string) => {
		setSelectedUserIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	const handleRing = async () => {
		setLoading(true);
		setError('');
		setSuccess(false);

		const result = await api.ringGather({
			message: message || undefined,
			is_anonymous: isAnonymous || undefined,
			target_user_ids:
				sendTo === 'specific' && selectedUserIds.size > 0 ? Array.from(selectedUserIds) : undefined,
		});

		if (result.ok) {
			setSuccess(true);
			setMessage('');
			setIsAnonymous(false);
			setSendTo('everyone');
			setSelectedUserIds(new Set());
		} else {
			setError(result.error.message);
		}
		setLoading(false);
	};

	return (
		<div>
			<h2 style={{ marginBottom: '20px' }}>Gather Bell</h2>

			<div class="card" style={{ maxWidth: '480px', width: '100%' }}>
				<p style={{ marginBottom: '12px', color: 'var(--text-secondary)' }}>
					Ring the gather bell to notify others you're ready to play!
				</p>

				<input
					type="text"
					placeholder="Optional message (e.g. 'CS2 anyone?')"
					value={message}
					onInput={(e) => setMessage((e.target as HTMLInputElement).value)}
					style={{ width: '100%', marginBottom: '12px' }}
					maxLength={500}
				/>

				<label
					style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', cursor: 'pointer', fontSize: '14px' }}
				>
					<input
						type="checkbox"
						checked={isAnonymous}
						onChange={(e) => setIsAnonymous((e.target as HTMLInputElement).checked)}
						style={{ width: '16px', height: '16px' }}
					/>
					Ring anonymously (hide your name)
				</label>

				<div style={{ marginBottom: '16px' }}>
					<div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
						<button
							class={`btn ${sendTo === 'everyone' ? 'btn-primary' : 'btn-secondary'}`}
							style={{ padding: '4px 12px', fontSize: '12px' }}
							onClick={() => setSendTo('everyone')}
						>
							Everyone
						</button>
						<button
							class={`btn ${sendTo === 'specific' ? 'btn-primary' : 'btn-secondary'}`}
							style={{ padding: '4px 12px', fontSize: '12px' }}
							onClick={() => setSendTo('specific')}
						>
							Specific users
						</button>
					</div>

					{sendTo === 'specific' && (
						<div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
							{users.length === 0 && (
								<p style={{ fontSize: '12px', color: 'var(--text-muted)' }}>No other users yet.</p>
							)}
							{users.map((u) => (
								<button
									key={u.id}
									class={`btn ${selectedUserIds.has(u.id) ? 'btn-primary' : 'btn-secondary'}`}
									style={{ padding: '4px 10px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}
									onClick={() => toggleUser(u.id)}
								>
									{u.avatar_url && (
										<img src={u.avatar_url} alt="" style={{ width: '18px', height: '18px', borderRadius: '50%' }} />
									)}
									{u.discord_username}
								</button>
							))}
						</div>
					)}
				</div>

				<button class="btn btn-primary" onClick={handleRing} disabled={loading}>
					{loading ? 'Ringing...' : '🔔 Ring the Bell'}
				</button>

				{error && (
					<p style={{ color: 'var(--danger)', fontSize: '13px', marginTop: '8px' }}>{error}</p>
				)}
				{success && (
					<p style={{ color: 'var(--success)', fontSize: '13px', marginTop: '8px' }}>
						Bell rung! Others will be notified via Discord.
					</p>
				)}
			</div>
		</div>
	);
}
