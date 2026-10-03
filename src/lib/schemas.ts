import { z } from 'zod';

/** Discord identity fields the bot sends for a user (POST /api/auth/token, POST /api/users/sync). */
export const discordUserSchema = z.object({
	discord_id: z.string().min(1).max(30),
	discord_username: z.string().min(1).max(50),
	// null is accepted like an absent value (the stored avatar is kept)
	avatar_url: z.string().max(500).nullish(),
});

export const guildNameSchema = z.string().max(100).optional();
