interface ServerUnreachableProps {
	message: string | null;
	onRetry: () => void;
}

/** Shown when the app cannot load the current user because the server gave no usable answer. */
export function ServerUnreachable({ message, onRetry }: ServerUnreachableProps) {
	return (
		<div
			style={{
				height: '100%',
				display: 'flex',
				flexDirection: 'column',
				alignItems: 'center',
				justifyContent: 'center',
				gap: '16px',
				padding: '16px',
			}}
		>
			<h1 style={{ fontSize: '36px', fontWeight: 700, color: 'var(--accent-text)' }}>when2play</h1>
			<div role="alert" class="card" style={{ padding: '20px 24px', maxWidth: '400px', textAlign: 'center' }}>
				<p style={{ color: 'var(--danger)', fontSize: '16px', fontWeight: 600, marginBottom: '8px' }}>Cannot reach the server</p>
				{message && <p style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>{message}</p>}
			</div>
			<button class="btn btn-primary" onClick={onRetry}>
				Retry
			</button>
		</div>
	);
}
