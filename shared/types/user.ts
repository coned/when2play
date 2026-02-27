export interface User {
	id: string;
	discord_id: string;
	discord_username: string;
	display_name: string | null;
	sync_name_from_discord: boolean;
	avatar_url: string | null;
	timezone: string;
	time_granularity_minutes: number;
	is_admin: boolean;
	created_at: string;
	updated_at: string;
}

export interface UpdateUserRequest {
	discord_username?: string;
	display_name?: string;
	sync_name_from_discord?: boolean;
	timezone?: string;
	time_granularity_minutes?: number;
}
