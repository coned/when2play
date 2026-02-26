import type { ApiResult } from '@when2play/shared';

const BASE = '/api';

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
	getUsers: () => request<Array<{ id: string; discord_username: string; avatar_url: string | null }>>('/users'),

	// Gather
	ringGather: (options?: { message?: string; is_anonymous?: boolean; target_user_ids?: string[] }) =>
		request<any>('/gather', { method: 'POST', body: JSON.stringify(options ?? {}) }),
	getPendingGather: () => request<any[]>('/gather/pending'),

	// Shame
	shameUser: (targetId: string, reason?: string) =>
		request<any>(`/shame/${targetId}`, { method: 'POST', body: JSON.stringify({ reason }) }),
	getShameLeaderboard: () => request<any[]>('/shame/leaderboard'),

	// Settings
	getSettings: () => request<Record<string, unknown>>('/settings'),
	updateSettings: (data: Record<string, unknown>) =>
		request<Record<string, unknown>>('/settings', { method: 'PATCH', body: JSON.stringify(data) }),

	// Steam
	lookupSteam: (appId: string) => request<{ name: string; header_image: string }>(`/steam/lookup/${appId}`),
	searchSteam: (query: string) => request<Array<{ app_id: string; name: string; image_url: string }>>(`/steam/search?q=${encodeURIComponent(query)}`),
};
