interface LoginPromptProps {
	/** The app had a user and an API call said the session is gone */
	expired?: boolean;
}

const screenStyle = {
	height: '100%',
	display: 'flex',
	flexDirection: 'column',
	alignItems: 'center',
	justifyContent: 'center',
	gap: '20px',
	padding: '16px',
} as const;

/** Shown when there is no session: how to get a login link from the Discord bot. */
export function LoginPrompt({ expired = false }: LoginPromptProps) {
	return (
		<div style={screenStyle}>
			<h1 style={{ fontSize: '36px', fontWeight: 700, color: 'var(--accent)' }}>when2play</h1>
			{expired && (
				<p role="alert" style={{ color: 'var(--warning)', fontSize: '16px', fontWeight: 600, textAlign: 'center', maxWidth: '400px' }}>
					Your session has expired. Get a new login link to continue.
				</p>
			)}
			<div class="card" style={{ padding: '20px 24px', maxWidth: '400px', textAlign: 'center' }}>
				<p style={{ color: 'var(--text-secondary)', fontSize: '15px', marginBottom: '8px' }}>
					To log in, run <code>/when2play</code> in your Discord server.
				</p>
				<p style={{ color: 'var(--text-muted)', fontSize: '13px' }}>
					The bot replies with a personal login link. It is valid for 10 minutes and works once.
				</p>
			</div>
		</div>
	);
}
