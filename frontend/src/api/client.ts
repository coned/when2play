import type { ApiError, ApiResult, AvailabilityStatusMap } from '@when2play/shared';

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
		if (r.ok) {
			rec.result = r;
			rec.at = Date.now();
		} else if (_getCache.get(path) === rec) {
			// Never cache a failure: the next call (a Retry) must ask again
			_getCache.delete(path);
		}
		return r;
	});
	_getCache.set(path, rec);
	return rec.promise;
}

/** Error code of a request that got no usable answer: no connection, or a response that is not API JSON. */
export const NETWORK_ERROR = 'NETWORK_ERROR';

function networkError(message: string): ApiError {
	return { ok: false, error: { code: NETWORK_ERROR, message } };
}

function isApiResult(body: unknown): body is ApiResult<unknown> {
	if (!body || typeof body !== 'object') return false;
	const b = body as { ok?: unknown; error?: { code?: unknown; message?: unknown } };
	if (b.ok === true) return true;
	return b.ok === false && !!b.error && typeof b.error.code === 'string' && typeof b.error.message === 'string';
}

/**
 * Called when an API request shows that the browser has no valid session any more:
 * 401 UNAUTHORIZED (session expired or deleted) or 400 MISSING_GUILD (the guild
 * cookie expired together with the session cookie). useAuth decides what to do
 * with it (only a logged-in app reacts).
 */
let sessionLostHandler: (() => void) | null = null;

export function setSessionLostHandler(handler: (() => void) | null) {
	sessionLostHandler = handler;
}

function isSessionLost(status: number, code: string): boolean {
	return (status === 401 && code === 'UNAUTHORIZED') || (status === 400 && code === 'MISSING_GUILD');
}

/**
 * Sends an API request. Never throws: a network failure or a response that is not
 * API JSON (for example an HTML error page from a proxy) comes back as
 * `{ ok: false, error: { code: 'NETWORK_ERROR', message } }`.
 */
async function request<T>(path: string, options: RequestInit = {}): Promise<ApiResult<T>> {
	let res: Response;
	try {
		res = await fetch(`${BASE}${path}`, {
			credentials: 'include',
			headers: {
				'Content-Type': 'application/json',
				...(options.headers || {}),
			},
			...options,
		});
	} catch {
		return networkError('Could not reach the server. Check your connection and try again.');
	}

	let body: unknown;
	try {
		body = await res.json();
	} catch {
		body = undefined;
	}
	if (!isApiResult(body)) {
		return networkError(`The server sent an unexpected response (HTTP ${res.status}). Try again in a moment.`);
	}
	if (!body.ok && isSessionLost(res.status, body.error.code)) {
		_getCache.clear();
		sessionLostHandler?.();
	}
	return body as ApiResult<T>;
}

export const api = {
	// Auth
	logout: () => request('/auth/logout', { method: 'POST' }),

	// Users
	getMe: () => request<any>('/users/me'),
	updateMe: (data: Record<string, unknown>) => request<any>('/users/me', { method: 'PATCH', body: JSON.stringify(data) }),

	// Games
	getGames: (includeArchived = false, pool?: 'active' | 'archive' | 'all') => {
		if (pool) return request<any[]>(`/games?pool=${pool}`);
		return request<any[]>(`/games${includeArchived ? '?include_archived=true' : ''}`);
	},
	createGame: (data: { name: string; steam_app_id?: string; image_url?: string; note?: string }) =>
		request<any>('/games', { method: 'POST', body: JSON.stringify(data) }),
	updateGame: (id: string, data: Record<string, unknown>) =>
		request<any>(`/games/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
	archiveGame: (id: string, reason?: string) =>
		request<null>(`/games/${id}`, {
			method: 'DELETE',
			body: JSON.stringify({ reason: reason ?? 'not_interested' }),
		}),
	reactToGame: (id: string, type: 'like' | 'dislike') =>
		request<null>(`/games/${id}/react`, { method: 'PUT', body: JSON.stringify({ type }) }),
	removeReaction: (id: string) => request<null>(`/games/${id}/react`, { method: 'DELETE' }),
	restoreGame: (id: string) => request<null>(`/games/${id}/restore`, { method: 'POST' }),
	deleteGamePermanently: (id: string) => request<null>(`/games/${id}/permanent`, { method: 'DELETE' }),
	shareGame: (id: string) => request<any>(`/games/${id}/share`, { method: 'POST' }),
	getGameActivity: (limit?: number, before?: string) => {
		const params = new URLSearchParams();
		if (limit) params.set('limit', String(limit));
		if (before) params.set('before', before);
		const qs = params.toString();
		return request<any[]>(`/games/activity${qs ? `?${qs}` : ''}`);
	},

	// Votes
	getGameRanking: () => request<any[]>('/games/ranking'),
	setVote: (gameId: string, data: { rank: number; is_approved?: boolean }) =>
		request<any>(`/games/${gameId}/vote`, { method: 'PUT', body: JSON.stringify(data) }),
	deleteVote: (gameId: string) => request<null>(`/games/${gameId}/vote`, { method: 'DELETE' }),
	deleteAllVotes: () => request<null>('/games/my-votes', { method: 'DELETE' }),
	getGameVotes: (gameId: string) => request<any[]>(`/games/${gameId}/votes`),
	getMyVotes: () => request<any[]>('/games/my-votes'),
	reorderVotes: (rankings: Array<{ game_id: string; rank: number }>) =>
		request<null>('/games/reorder-votes', { method: 'PUT', body: JSON.stringify({ rankings }) }),

	// Availability
	getAvailability: (params?: { user_id?: string; date?: string }) => {
		const qs = new URLSearchParams(params as Record<string, string>).toString();
		return request<any[]>(`/availability${qs ? `?${qs}` : ''}`);
	},
	setAvailability: (data: { date: string; slots: Array<{ start_time: string; end_time: string; slot_status?: string }> }) =>
		request<any[]>('/availability', { method: 'PUT', body: JSON.stringify(data) }),
	clearAvailability: (date: string) => request<null>(`/availability?date=${date}`, { method: 'DELETE' }),
	getMyAvailabilityStatus: (from: string, to: string) =>
		request<AvailabilityStatusMap>(`/availability/my-status?from=${from}&to=${to}`),
	confirmAvailability: (date: string) =>
		request<any[]>(`/availability/${date}/confirm`, { method: 'POST' }),

	// Users (all)
	getUsers: () => cachedGet<Array<{ id: string; discord_username: string; display_name: string | null; avatar_url: string | null }>>('/users'),

	// Gather (DEPRECATED: merged into rally, UI hidden since v0.3)
	ringGather: (options?: { message?: string; is_anonymous?: boolean; target_user_ids?: string[] }) =>
		request<any>('/gather', { method: 'POST', body: JSON.stringify(options ?? {}) }),

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

	// Guilds
	getMyGuilds: () => request<{ guilds: Array<{ guild_id: string; guild_name: string | null }>; current_guild_id: string | null }>('/guilds/mine'),
	switchGuild: (guildId: string) => request<null>('/guilds/switch', { method: 'POST', body: JSON.stringify({ guild_id: guildId }) }),

	// Rally
	createRally: (data?: { message?: string; is_anonymous?: boolean }) =>
		request<any>('/rally/call', { method: 'POST', body: JSON.stringify(data ?? {}) }),
	shareRanking: () => request<any>('/rally/share-ranking', { method: 'POST' }),
	rallyAction: (data: { action_type: string; target_user_ids?: string[]; message?: string; is_anonymous?: boolean }) =>
		request<any>('/rally/action', { method: 'POST', body: JSON.stringify(data) }),
	judgeTime: () => request<any>('/rally/judge/time', { method: 'POST' }),
	judgeAvail: (data: { target_user_ids: string[]; message?: string }) =>
		request<any>('/rally/judge/avail', { method: 'POST', body: JSON.stringify(data) }),
	getActiveRally: () => request<any>('/rally/active'),
	getTreeData: (dayKey?: string) => request<any>(`/rally/tree${dayKey ? `?day_key=${dayKey}` : ''}`),
	shareTree: (data: { image_data: string }) =>
		request<any>('/rally/tree/share', { method: 'POST', body: JSON.stringify(data) }),
};
