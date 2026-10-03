import { Hono } from 'hono';
import type { Bindings } from '../env';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth';
import { requireBotAuth } from '../middleware/bot-auth';
import { updateUser, getAllUsers, upsertUser, type UserRow } from '../db/queries/users';
import { updateSettings } from '../db/queries/settings';
import { discordUserSchema, guildNameSchema } from '../lib/schemas';

type UsersEnv = {
	Bindings: Bindings;
	Variables: {
		user: UserRow;
		sessionId: string;
		isAdmin: boolean;
	};
};

const users = new Hono<UsersEnv>();

const MAX_SYNC_USERS = 10;

const syncUsersSchema = z.object({
	users: z.array(discordUserSchema).min(1).max(MAX_SYNC_USERS),
	guild_name: guildNameSchema,
});

// --- Bot-auth endpoints (registered before the blanket requireAuth) ---

// POST /api/users/sync -- bot upserts Discord users (no token, no session) before acting as them
users.post('/sync', requireBotAuth, async (c) => {
	const raw = await c.req.json().catch(() => null);
	const parsed = syncUsersSchema.safeParse(raw);
	if (!parsed.success) {
		return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: `Invalid request body: users must be 1 to ${MAX_SYNC_USERS} entries of { discord_id, discord_username, avatar_url? }` } }, 400);
	}

	const rows: Array<Pick<UserRow, 'id' | 'discord_id' | 'discord_username' | 'display_name' | 'avatar_url'>> = [];
	for (const u of parsed.data.users) {
		const row = await upsertUser(c.env.DB, u.discord_id, u.discord_username, u.avatar_url ?? undefined);
		rows.push({ id: row.id, discord_id: row.discord_id, discord_username: row.discord_username, display_name: row.display_name, avatar_url: row.avatar_url });
	}

	if (parsed.data.guild_name) {
		await updateSettings(c.env.DB, { guild_name: parsed.data.guild_name });
	}

	return c.json({ ok: true, data: { users: rows } });
});

// --- User-auth endpoints ---
users.use('/*', requireAuth);

// GET /api/users — list all users (id, username, display_name, avatar)
users.get('/', async (c) => {
	const allUsers = await getAllUsers(c.env.DB);
	return c.json({ ok: true, data: allUsers });
});

// GET /api/users/me
users.get('/me', (c) => {
	const user = c.get('user');
	return c.json({ ok: true, data: { ...user, is_admin: c.get('isAdmin') } });
});

// PATCH /api/users/me
users.patch('/me', async (c) => {
	const user = c.get('user');
	const body = await c.req.json<{
		discord_username?: string;
		display_name?: string;
		sync_name_from_discord?: boolean;
		timezone?: string;
		time_granularity_minutes?: number;
	}>();

	if (body.time_granularity_minutes !== undefined && (body.time_granularity_minutes < 5 || body.time_granularity_minutes > 60)) {
		return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'time_granularity_minutes must be between 5 and 60' } }, 400);
	}

	if (body.display_name !== undefined && body.display_name.length > 50) {
		return c.json({ ok: false, error: { code: 'BAD_REQUEST', message: 'display_name must be 50 characters or less' } }, 400);
	}

	const updates: Record<string, unknown> = {};
	if (body.discord_username !== undefined) updates.discord_username = body.discord_username;
	if (body.display_name !== undefined) updates.display_name = body.display_name;
	if (body.sync_name_from_discord !== undefined) updates.sync_name_from_discord = body.sync_name_from_discord ? 1 : 0;
	if (body.timezone !== undefined) updates.timezone = body.timezone;
	if (body.time_granularity_minutes !== undefined) updates.time_granularity_minutes = body.time_granularity_minutes;

	const updated = await updateUser(c.env.DB, user.id, updates);
	return c.json({ ok: true, data: updated });
});

export default users;
