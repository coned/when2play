export interface ShameVote {
	id: string;
	voter_id: string;
	target_id: string;
	reason: string | null;
	is_anonymous: boolean;
	created_at: string;
}

export interface CreateShameRequest {
	reason?: string;
	is_anonymous?: boolean;
}

export interface ShameReasonEntry {
	reason: string;
	voter_id: string | null;
	voter_name: string | null;
	voter_avatar: string | null;
}

export interface ShameLeaderboardEntry {
	user_id: string;
	discord_username: string;
	avatar_url: string | null;
	shame_count_today: number;
	shame_count_week: number;
}
