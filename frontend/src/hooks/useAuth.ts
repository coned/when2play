import { useState, useEffect, useCallback, useRef } from 'preact/hooks';
import { api, NETWORK_ERROR, setSessionLostHandler } from '../api/client';
import type { User } from '@when2play/shared';

/**
 * - loading: the first /api/users/me is on its way
 * - authenticated: `user` is set
 * - logged-out: no session (the normal state before the first login)
 * - expired: the app had a user, then an API call said the session is gone
 * - unreachable: /api/users/me got no usable answer; `error` says why
 */
export type AuthStatus = 'loading' | 'authenticated' | 'logged-out' | 'expired' | 'unreachable';

interface AuthState {
	user: User | null;
	status: AuthStatus;
	error: string | null;
}

export function useAuth() {
	const [state, setState] = useState<AuthState>({ user: null, status: 'loading', error: null });
	const userRef = useRef<User | null>(null);
	userRef.current = state.user;

	const fetchUser = useCallback(async () => {
		// A refetch while logged in (after a profile edit) keeps the app on screen
		if (!userRef.current) setState({ user: null, status: 'loading', error: null });
		const result = await api.getMe();

		if (result.ok) {
			setState({ user: result.data, status: 'authenticated', error: null });
			return;
		}
		// A failed refetch while logged in: the session-lost handler covers 401s, keep the rest
		if (userRef.current) return;
		const code = result.error.code;
		if (code === NETWORK_ERROR || code === 'INTERNAL_ERROR') {
			setState({ user: null, status: 'unreachable', error: result.error.message });
		} else {
			// 401 UNAUTHORIZED, 400 MISSING_GUILD and friends: simply not logged in
			setState({ user: null, status: 'logged-out', error: null });
		}
	}, []);

	useEffect(() => {
		setSessionLostHandler(() => {
			if (userRef.current) {
				userRef.current = null;
				setState({ user: null, status: 'expired', error: null });
			}
		});
		fetchUser();
		return () => setSessionLostHandler(null);
	}, [fetchUser]);

	const logout = useCallback(async () => {
		// Clear the user first so a 401 from the logout call is not reported as an expired session
		userRef.current = null;
		await api.logout();
		setState({ user: null, status: 'logged-out', error: null });
	}, []);

	return { ...state, loading: state.status === 'loading', refetch: fetchUser, logout };
}
