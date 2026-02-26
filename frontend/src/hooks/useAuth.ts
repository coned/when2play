import { useState, useEffect, useCallback } from 'preact/hooks';
import { api } from '../api/client';
import type { User } from '@when2play/shared';

interface AuthState {
	user: User | null;
	loading: boolean;
	error: string | null;
}

export function useAuth() {
	const [state, setState] = useState<AuthState>({ user: null, loading: true, error: null });

	const fetchUser = useCallback(async () => {
		setState((s) => ({ ...s, loading: true }));
		const result = await api.getMe();

		if (result.ok) {
			setState({ user: result.data, loading: false, error: null });
		} else {
			setState({ user: null, loading: false, error: null });
		}
	}, []);

	useEffect(() => {
		fetchUser();
	}, [fetchUser]);

	const logout = useCallback(async () => {
		await api.logout();
		setState({ user: null, loading: false, error: null });
	}, []);

	return { ...state, refetch: fetchUser, logout };
}
