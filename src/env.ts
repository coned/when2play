export interface Bindings {
	DB: D1Database;
	BOT_API_KEY?: string;
	VERBOSE_ERRORS?: string;
	[key: `DB_${string}`]: D1Database;
}
