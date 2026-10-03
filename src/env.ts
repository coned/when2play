export interface Bindings {
	/** Resolved by the guildDb middleware from DB_<guild_id>. Not a Cloudflare binding. */
	DB: D1Database;
	BOT_API_KEY?: string;
	VERBOSE_ERRORS?: string;
	/** Short commit hash the Worker was deployed from, with -dirty for uncommitted changes. Set by `make deploy`. */
	GIT_SHA?: string;
	[key: `DB_${string}`]: D1Database;
}
