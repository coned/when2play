export interface Setting {
	key: string;
	value: string;
	updated_at: string;
}

export interface SettingsMap {
	time_granularity_minutes: number;
	game_pool_lifespan_days: number;
	gather_cooldown_minutes: number;
	[key: string]: unknown;
}

export interface UpdateSettingsRequest {
	[key: string]: unknown;
}
