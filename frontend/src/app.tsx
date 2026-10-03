import { useAuth } from './hooks/useAuth';
import { Home } from './pages/Home';
import { AuthCallback } from './pages/AuthCallback';
import { LoginPrompt } from './pages/LoginPrompt';
import { ServerUnreachable } from './pages/ServerUnreachable';
import { LoadingSpinner } from './components/ui/LoadingSpinner';

export function App() {
	// Simple path-based routing: the login link is /auth/<token>, everything else is the app
	const path = window.location.pathname;
	if (path.startsWith('/auth/')) {
		const token = path.slice('/auth/'.length);
		return <AuthCallback token={token} />;
	}
	return <MainApp />;
}

function MainApp() {
	const { user, status, error, logout, refetch } = useAuth();

	if (status === 'loading') return <LoadingSpinner />;
	if (status === 'unreachable') return <ServerUnreachable message={error} onRetry={refetch} />;
	if (!user) return <LoginPrompt expired={status === 'expired'} />;

	return <Home user={user} onLogout={logout} onUserUpdate={refetch} />;
}
