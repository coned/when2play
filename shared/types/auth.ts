export interface AuthToken {
	id: string;
	token: string;
	user_id: string;
	expires_at: string;
	used: boolean;
	created_at: string;
}

export interface Session {
	id: string;
	session_id: string;
	user_id: string;
	expires_at: string;
	created_at: string;
}

export interface CreateTokenRequest {
	discord_id: string;
	discord_username: string;
	avatar_url?: string;
}

export interface CreateTokenResponse {
	token: string;
	url: string;
}
