import type { ApiResult } from '@when2play/shared';

const BASE = '/api';

const _getCache = new Map<string, { promise: Promise<any>; result: any; at: number }>();
const GET_TTL_MS = 20_000;

function cachedGet<T>(path: string): Promise<ApiResult<T>> {
	const now = Date.now();
	const entry = _getCache.get(path);
	if (entry) {
		if (entry.result && now - entry.at < GET_TTL_MS) return Promise.resolve(entry.result);
		if (entry.promise && !entry.result) return entry.promise;
	}
	const rec: { promise: Promise<any>; result: any; at: number } = { promise: null!, result: null, at: 0 };
	rec.promise = request<T>(path).then(r => {
		rec.result = r;
		rec.at = Date.now();
		return r;
	});
	_getCache.set(path, rec);
	return rec.promise;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<ApiResult<T>> {
	const res = await fetch(`${BASE}${path}`, {
		credentials: 'include',
		headers: {
			'Content-Type': 'application/json',
			...(options.headers || {}),
		},
		...options,
	});

	return res.json();
}

export const api = {
	// Auth
	logout: () => request('/auth/logout', { method: 'POST' }),

	// Users
	getMe: () => request<any>('/users/me'),
	updateMe: (data: Record<string, unknown>) => request<any>('/users/me', { method: 'PATCH', body: JSON.stringify(data) }),

	// Games
	getGames: (includeArchived = false) => request<any[]>(`/games${includeArchived ? '?include_archived=true' : ''}`),
	createGame: (data: { name: string; steam_app_id?: string; image_url?: string }) =>
		request<any>('/games', { method: 'POST', body: JSON.stringify(data) }),
	updateGame: (id: string, data: Record<string, unknown>) =>
		request<any>(`/games/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
	archiveGame: (id: string) => request<null>(`/games/${id}`, { method: 'DELETE' }),

	// Votes
	getGameRanking: () => request<any[]>('/games/ranking'),
	setVote: (gameId: string, data: { rank: number; is_approved?: boolean }) =>
		request<any>(`/games/${gameId}/vote`, { method: 'PUT', body: JSON.stringify(data) }),
	deleteVote: (gameId: string) => request<null>(`/games/${gameId}/vote`, { method: 'DELETE' }),
	getGameVotes: (gameId: string) => request<any[]>(`/games/${gameId}/votes`),
	getMyVotes: () => request<any[]>('/games/my-votes'),
	reorderVotes: (rankings: Array<{ game_id: string; rank: number }>) =>
		request<null>('/games/reorder-votes', { method: 'PUT', body: JSON.stringify({ rankings }) }),

	// Availability
	getAvailability: (params?: { user_id?: string; date?: string }) => {
		const qs = new URLSearchParams(params as Record<string, string>).toString();
		return request<any[]>(`/availability${qs ? `?${qs}` : ''}`);
	},
	setAvailability: (data: { date: string; slots: Array<{ start_time: string; end_time: string }> }) =>
		request<any[]>('/availability', { method: 'PUT', body: JSON.stringify(data) }),
	clearAvailability: (date: string) => request<null>(`/availability?date=${date}`, { method: 'DELETE' }),

	// Users (all)
	getUsers: () => cachedGet<Array<{ id: string; discord_username: string; display_name: string | null; avatar_url: string | null }>>('/users'),

	// Gather
	ringGather: (options?: { message?: string; is_anonymous?: boolean; target_user_ids?: string[] }) =>
		request<any>('/gather', { method: 'POST', body: JSON.stringify(options ?? {}) }),
	getPendingGather: () => request<any[]>('/gather/pending'),

	// Shame
	shameUser: (targetId: string, reason?: string, isAnonymous = false) =>
		request<any>(`/shame/${targetId}`, { method: 'POST', body: JSON.stringify({ reason, is_anonymous: isAnonymous }) }),
	withdrawShame: (targetId: string) => request<null>(`/shame/${targetId}`, { method: 'DELETE' }),
	getShameLeaderboard: () => request<any[]>('/shame/leaderboard'),
	getMyShameVotes: () => request<string[]>('/shame/my-votes'),

	// Settings
	getSettings: () => request<Record<string, unknown>>('/settings'),
	updateSettings: (data: Record<string, unknown>) =>
		request<Record<string, unknown>>('/settings', { method: 'PATCH', body: JSON.stringify(data) }),

	// Steam
	lookupSteam: (appId: string) => request<{ name: string; header_image: string }>(`/steam/lookup/${appId}`),
	searchSteam: (query: string) => request<Array<{ app_id: string; name: string; image_url: string }>>(`/steam/search?q=${encodeURIComponent(query)}`),

	// Rally
	createRally: (data?: { message?: string; is_anonymous?: boolean }) =>
		request<any>('/rally/call', { method: 'POST', body: JSON.stringify(data ?? {}) }),
	shareRanking: () => request<any>('/rally/share-ranking', { method: 'POST' }),
	rallyAction: (data: { action_type: string; target_user_ids?: string[]; message?: string }) =>
		request<any>('/rally/action', { method: 'POST', body: JSON.stringify(data) }),
	judgeTime: () => request<any>('/rally/judge/time', { method: 'POST' }),
	judgeAvail: (data: { target_user_ids: string[] }) =>
		request<any>('/rally/judge/avail', { method: 'POST', body: JSON.stringify(data) }),
	getActiveRally: () => request<any>('/rally/active'),
	getTreeData: (dayKey?: string) => request<any>(`/rally/tree${dayKey ? `?day_key=${dayKey}` : ''}`),
	shareTree: (data: { image_data: string }) =>
		request<any>('/rally/tree/share', { method: 'POST', body: JSON.stringify(data) }),
};
