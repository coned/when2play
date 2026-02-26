const DISCORD_API = 'https://discord.com/api/v10';

/**
 * Thin wrapper around the Discord REST API.
 * Uses the bot token (Bearer) for all calls.
 */
export class DiscordAPI {
	private token: string;
	private appId: string;

	constructor(token: string, appId: string) {
		this.token = token;
		this.appId = appId;
	}

	private headers() {
		return {
			Authorization: `Bot ${this.token}`,
			'Content-Type': 'application/json',
		};
	}

	/** Send a message to a channel. Returns the message object. */
	async sendMessage(channelId: string, body: object): Promise<DiscordMessage> {
		const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages`, {
			method: 'POST',
			headers: this.headers(),
			body: JSON.stringify(body),
		});
		if (!res.ok) throw new Error(`sendMessage failed: ${res.status} ${await res.text()}`);
		return res.json();
	}

	/** Edit an existing message (e.g. update vote counts on a poll). */
	async editMessage(channelId: string, messageId: string, body: object): Promise<void> {
		const res = await fetch(`${DISCORD_API}/channels/${channelId}/messages/${messageId}`, {
			method: 'PATCH',
			headers: this.headers(),
			body: JSON.stringify(body),
		});
		if (!res.ok) throw new Error(`editMessage failed: ${res.status} ${await res.text()}`);
	}

	/**
	 * Edit the original response to a deferred interaction.
	 * Use this after responding with DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE (type 5).
	 * The interaction token stays valid for 15 minutes.
	 */
	async editInteractionResponse(interactionToken: string, body: object): Promise<void> {
		const res = await fetch(`${DISCORD_API}/webhooks/${this.appId}/${interactionToken}/messages/@original`, {
			method: 'PATCH',
			headers: this.headers(),
			body: JSON.stringify(body),
		});
		if (!res.ok) throw new Error(`editInteractionResponse failed: ${res.status} ${await res.text()}`);
	}

	/**
	 * Post a followup message to an interaction (used after deferral).
	 * Set flags: 64 in the body to make it ephemeral (only visible to the clicker).
	 */
	async createFollowup(interactionToken: string, body: object): Promise<void> {
		const res = await fetch(`${DISCORD_API}/webhooks/${this.appId}/${interactionToken}`, {
			method: 'POST',
			headers: this.headers(),
			body: JSON.stringify(body),
		});
		if (!res.ok) throw new Error(`createFollowup failed: ${res.status} ${await res.text()}`);
	}

	/**
	 * Register global slash commands with Discord.
	 * Safe to run repeatedly — PUT does a full overwrite (idempotent).
	 */
	async registerGlobalCommands(commands: any[]): Promise<any[]> {
		const res = await fetch(`${DISCORD_API}/applications/${this.appId}/commands`, {
			method: 'PUT',
			headers: this.headers(),
			body: JSON.stringify(commands),
		});
		if (!res.ok) throw new Error(`registerGlobalCommands failed: ${res.status} ${await res.text()}`);
		return res.json();
	}

	/**
	 * Register guild-specific slash commands with Discord.
	 * Updates instantly, unlike global commands which can take up to an hour.
	 */
	async registerGuildCommands(commands: any[], guildId: string): Promise<any[]> {
		const res = await fetch(`${DISCORD_API}/applications/${this.appId}/guilds/${guildId}/commands`, {
			method: 'PUT',
			headers: this.headers(),
			body: JSON.stringify(commands),
		});
		if (!res.ok) throw new Error(`registerGuildCommands failed: ${res.status} ${await res.text()}`);
		return res.json();
	}
}

export interface DiscordMessage {
	id: string;
	channel_id: string;
	content: string;
}
