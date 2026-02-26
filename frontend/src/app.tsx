import { useAuth } from './hooks/useAuth';
import { Home } from './pages/Home';
import { AuthCallback } from './pages/AuthCallback';
import { LoadingSpinner } from './components/ui/LoadingSpinner';

export function App() {
	const { user, loading, logout } = useAuth();

	// Simple path-based routing
	const path = window.location.pathname;

	// Auth callback route
	if (path.startsWith('/auth/')) {
		const token = path.split('/auth/')[1];
		return <AuthCallback token={token} />;
	}

	// Loading state
	if (loading) {
		return <LoadingSpinner />;
	}

	// Not authenticated — show login prompt
	if (!user) {
		return (
			<div
				style={{
					height: '100%',
					display: 'flex',
					flexDirection: 'column',
					alignItems: 'center',
					justifyContent: 'center',
					gap: '20px',
				}}
			>
				<h1 style={{ fontSize: '36px', fontWeight: 700, color: 'var(--accent)' }}>when2play</h1>
				<p style={{ color: 'var(--text-secondary)', fontSize: '16px', textAlign: 'center', maxWidth: '400px' }}>
					Get a login link from the Discord bot to access the dashboard.
				</p>
				<div class="card" style={{ padding: '20px 24px', textAlign: 'center' }}>
					<p style={{ color: 'var(--text-muted)', fontSize: '14px' }}>Waiting for auth link...</p>
				</div>
			</div>
		);
	}

	// Authenticated — show dashboard
	return <Home user={user} onLogout={logout} />;
}
