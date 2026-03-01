import { useEffect, useState } from 'preact/hooks';

interface AuthCallbackProps {
	token?: string;
}

export function AuthCallback({ token }: AuthCallbackProps) {
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!token) {
			setError('No token provided');
			return;
		}

		// Redirect to the backend callback which sets the session cookie
		const params = new URLSearchParams(window.location.search);
		const guild = params.get('guild');
		const qs = guild ? `?guild=${guild}` : '';
		window.location.href = `/api/auth/callback/${token}${qs}`;
	}, [token]);

	if (error) {
		return (
			<div
				style={{
					height: '100%',
					display: 'flex',
					flexDirection: 'column',
					alignItems: 'center',
					justifyContent: 'center',
					gap: '16px',
				}}
			>
				<h1 style={{ color: 'var(--danger)' }}>Authentication Error</h1>
				<p style={{ color: 'var(--text-secondary)' }}>{error}</p>
			</div>
		);
	}

	return (
		<div
			style={{
				height: '100%',
				display: 'flex',
				flexDirection: 'column',
				alignItems: 'center',
				justifyContent: 'center',
				gap: '16px',
			}}
		>
			<div class="spinner" />
			<p style={{ color: 'var(--text-secondary)' }}>Authenticating...</p>
		</div>
	);
}
