import { useState, useEffect } from 'preact/hooks';
import { api } from '../../api/client';

export function GatherBell() {
	const [message, setMessage] = useState('');
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState('');
	const [success, setSuccess] = useState(false);
	const [pending, setPending] = useState<any[]>([]);

	useEffect(() => {
		(async () => {
			const result = await api.getPendingGather();
			if (result.ok) setPending(result.data);
		})();
	}, []);

	const handleRing = async () => {
		setLoading(true);
		setError('');
		setSuccess(false);

		const result = await api.ringGather(message || undefined);
		if (result.ok) {
			setSuccess(true);
			setMessage('');
			// Refresh pending
			const pendingResult = await api.getPendingGather();
			if (pendingResult.ok) setPending(pendingResult.data);
		} else {
			setError(result.error.message);
		}
		setLoading(false);
	};

	return (
		<div>
			<h2 style={{ marginBottom: '20px' }}>Gather Bell</h2>

			<div class="card" style={{ maxWidth: '480px' }}>
				<p style={{ marginBottom: '12px', color: 'var(--text-secondary)' }}>
					Ring the gather bell to notify everyone you're ready to play!
				</p>

				<input
					type="text"
					placeholder="Optional message (e.g. 'CS2 anyone?')"
					value={message}
					onInput={(e) => setMessage((e.target as HTMLInputElement).value)}
					style={{ width: '100%', marginBottom: '12px' }}
				/>

				<button class="btn btn-primary" onClick={handleRing} disabled={loading}>
					{loading ? 'Ringing...' : 'Ring the Bell'}
				</button>

				{error && <p style={{ color: 'var(--danger)', fontSize: '13px', marginTop: '8px' }}>{error}</p>}
				{success && <p style={{ color: 'var(--success)', fontSize: '13px', marginTop: '8px' }}>Bell rung! Others will be notified.</p>}
			</div>

			{pending.length > 0 && (
				<div style={{ marginTop: '24px' }}>
					<h3 style={{ marginBottom: '12px' }}>Pending Pings</h3>
					<div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
						{pending.map((ping) => (
							<div key={ping.id} class="card" style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
								<span style={{ color: 'var(--warning)', fontSize: '18px' }}>*</span>
								<div>
									<span style={{ fontSize: '13px' }}>{ping.message || 'Ready to play!'}</span>
									<span class="text-muted" style={{ fontSize: '11px', marginLeft: '8px' }}>
										{new Date(ping.created_at).toLocaleTimeString()}
									</span>
								</div>
							</div>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
