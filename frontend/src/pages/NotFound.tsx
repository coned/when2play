export function NotFound() {
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
			<h1 style={{ fontSize: '48px', color: 'var(--accent)' }}>404</h1>
			<p style={{ color: 'var(--text-secondary)' }}>Page not found</p>
			<a href="/" class="btn btn-primary">
				Go home
			</a>
		</div>
	);
}
