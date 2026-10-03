import { Hono } from 'hono';
import type { Bindings } from '../env';
import { requireBotAuth } from '../middleware/bot-auth';
import { pollGuild, applyAcks, DELIVERY_KINDS, type GuildAcks, type GuildPending } from '../db/queries/bot-poll';

/**
 * Cross-guild bot endpoints. Mounted on the root app, outside the guildDb
 * middleware: these requests carry no X-Guild-Id, and each guild DB is read
 * directly from its DB_<guild_id> binding (c.env.DB is never set here).
 */
const bot = new Hono<{ Bindings: Bindings }>();

const GUILD_ID_RE = /^\d{17,20}$/;
const MAX_GUILDS = 100;
const MAX_ACKS_PER_LIST = 200;
const MAX_ACK_ID_LENGTH = 100;

type PollRequest = { guildIds: string[]; acks: Record<string, GuildAcks> };

function badRequest(message: string) {
	return { ok: false as const, error: { code: 'BAD_REQUEST', message } };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Validate the poll body. Returns an error message string on failure. */
function parsePollRequest(body: unknown): PollRequest | string {
	if (!isPlainObject(body)) return 'Body must be a JSON object';

	const rawIds = body.guild_ids;
	if (!Array.isArray(rawIds)) return 'guild_ids must be an array of guild IDs';
	for (const id of rawIds) {
		if (typeof id !== 'string' || !GUILD_ID_RE.test(id)) return 'guild_ids contains an invalid guild ID';
	}
	const guildIds = Array.from(new Set(rawIds as string[]));
	if (guildIds.length > MAX_GUILDS) return `guild_ids must contain at most ${MAX_GUILDS} guilds`;

	const acks: Record<string, GuildAcks> = {};
	if (body.acks !== undefined) {
		if (!isPlainObject(body.acks)) return 'acks must be an object keyed by guild ID';
		const ackGuilds = Object.keys(body.acks);
		if (ackGuilds.length > MAX_GUILDS) return `acks must contain at most ${MAX_GUILDS} guilds`;
		for (const guildId of ackGuilds) {
			if (!GUILD_ID_RE.test(guildId)) return 'acks contains an invalid guild ID';
			const entry = body.acks[guildId];
			if (!isPlainObject(entry)) return `acks.${guildId} must be an object`;
			const parsed: GuildAcks = {};
			for (const [kind, list] of Object.entries(entry)) {
				if (!(DELIVERY_KINDS as string[]).includes(kind)) return `acks.${guildId}.${kind} is not a known delivery kind`;
				if (list === undefined) continue;
				if (!Array.isArray(list)) return `acks.${guildId}.${kind} must be an array of IDs`;
				if (list.length > MAX_ACKS_PER_LIST) return `acks.${guildId}.${kind} must contain at most ${MAX_ACKS_PER_LIST} IDs`;
				for (const id of list) {
					if (typeof id !== 'string' || id.length === 0 || id.length > MAX_ACK_ID_LENGTH) return `acks.${guildId}.${kind} contains an invalid ID`;
				}
				parsed[kind as keyof GuildAcks] = list as string[];
			}
			acks[guildId] = parsed;
		}
	}

	return { guildIds, acks };
}

// POST /api/bot/poll -- one request per bot cycle: ack delivered items, fetch pending items for every guild
bot.post('/poll', requireBotAuth, async (c) => {
	const body = await c.req.json().catch(() => undefined);
	const parsed = parsePollRequest(body);
	if (typeof parsed === 'string') return c.json(badRequest(parsed), 400);

	const env = c.env as unknown as Record<string, D1Database | undefined>;
	const nowMs = Date.now();
	const polled = new Set(parsed.guildIds);
	const allGuildIds = Array.from(new Set([...parsed.guildIds, ...Object.keys(parsed.acks)]));

	const guilds: Record<string, GuildPending> = {};
	const unknownGuilds: string[] = [];
	const errors: Record<string, string> = {};

	await Promise.all(allGuildIds.map(async (guildId) => {
		const db = env[`DB_${guildId}`];
		if (!db) {
			unknownGuilds.push(guildId);
			return;
		}
		const acks = parsed.acks[guildId];
		const run = async (): Promise<GuildPending | null> => {
			if (polled.has(guildId)) return pollGuild(db, acks, nowMs);
			// Ack-only guild: apply the acks, do not poll it.
			if (acks) await applyAcks(db, acks);
			return null;
		};
		try {
			let result: GuildPending | null;
			try {
				result = await run();
			} catch (err) {
				console.error(`bot poll: guild ${guildId} failed, retrying:`, err);
				result = await run();
			}
			if (result) guilds[guildId] = result;
		} catch (err) {
			console.error(`bot poll: guild ${guildId} failed after retry:`, err);
			errors[guildId] = (err instanceof Error ? err.message : String(err)).slice(0, 200) || 'Unknown error';
		}
	}));

	// Keep the output order stable (request order) regardless of which guild finished first.
	const order = new Map(allGuildIds.map((id, i) => [id, i]));
	unknownGuilds.sort((a, b) => order.get(a)! - order.get(b)!);

	return c.json({ ok: true, data: { guilds, unknown_guilds: unknownGuilds, errors } });
});

export default bot;
