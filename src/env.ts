export interface Bindings {
	/** Resolved by the guildDb middleware from DB_<guild_id>. Not a Cloudflare binding. */
	DB: D1Database;
	BOT_API_KEY?: string;
	VERBOSE_ERRORS?: string;
	[key: `DB_${string}`]: D1Database;
}
