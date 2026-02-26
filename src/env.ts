// Typed environment bindings — generated types go in worker-configuration.d.ts,
// but we define our own interface here for clarity and manual secrets.

export interface Env {
	// D1 database binding (configured in wrangler.jsonc)
	DB: D1Database;

	// Non-secret vars (set in wrangler.jsonc "vars")
	DISCORD_APP_ID: string;
	DISCORD_PUBLIC_KEY: string;

	// Secret (set via: wrangler secret put DISCORD_BOT_TOKEN)
	DISCORD_BOT_TOKEN: string;
}
