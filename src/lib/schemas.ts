import { z } from 'zod';

/** Discord identity fields the bot sends for a user (POST /api/auth/token, POST /api/users/sync). */
export const discordUserSchema = z.object({
	discord_id: z.string().min(1).max(30),
	discord_username: z.string().min(1).max(50),
	// null is accepted like an absent value (the stored avatar is kept)
	avatar_url: z.string().max(500).nullish(),
});

export const guildNameSchema = z.string().max(100).optional();

/** Message of the first validation issue, for a 400 response. */
export function firstIssueMessage(error: z.ZodError, fallback: string): string {
	return error.issues[0]?.message ?? fallback;
}

/**
 * True for an IANA zone name such as "America/New_York" or "UTC". Offset strings
 * ("+05:00") are refused even where Intl accepts them.
 */
export function isIanaTimeZone(value: string): boolean {
	if (value.length === 0 || value.length > 64 || !/^[A-Za-z][A-Za-z0-9_+\-]*(\/[A-Za-z0-9_+\-]+)*$/.test(value)) return false;
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: value });
		return true;
	} catch {
		return false;
	}
}
