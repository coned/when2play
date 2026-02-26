export interface ShameVote {
	id: string;
	voter_id: string;
	target_id: string;
	reason: string | null;
	created_at: string;
}

export interface CreateShameRequest {
	reason?: string;
}

export interface ShameLeaderboardEntry {
	user_id: string;
	discord_username: string;
	avatar_url: string | null;
	shame_count: number;
}
