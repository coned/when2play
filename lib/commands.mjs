// Pure helpers for the slash command handlers. No side effects on import.

export const MAX_NAME_LENGTH = 50;
export const MAX_GUILD_NAME_LENGTH = 100;
export const MAX_AVATAR_URL_LENGTH = 500;

/** Cut a string to at most `max` UTF-16 units without splitting a surrogate pair. */
export function truncate(text, max) {
    if (text.length <= max) return text;
    let out = '';
    for (const ch of text) {
        if (out.length + ch.length > max) break;
        out += ch;
    }
    return out;
}

function nonEmpty(value) {
    return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/**
 * The name to store for a Discord user in a server, at most 50 characters.
 * `member` is a discord.js GuildMember (has displayName), a raw API member object (has `nick`,
 * which may be null) or null; `user` is the discord.js User.
 */
export function memberDisplayName(member, user) {
    const name = nonEmpty(member?.displayName)
        ?? nonEmpty(member?.nick)
        ?? nonEmpty(user?.displayName)
        ?? nonEmpty(user?.globalName)
        ?? nonEmpty(user?.username)
        ?? String(user?.id ?? 'unknown');
    return truncate(name, MAX_NAME_LENGTH);
}

/** Avatar URL for the sync body: null (keep the stored one) when missing or too long. */
export function avatarUrlFor(user) {
    let url = null;
    try {
        url = user?.displayAvatarURL?.({ size: 128 }) ?? null;
    } catch {
        url = null;
    }
    return typeof url === 'string' && url.length > 0 && url.length <= MAX_AVATAR_URL_LENGTH ? url : null;
}

/**
 * Body for POST /api/users/sync. `users` is a list of { discordId, name, avatarUrl }; duplicate
 * Discord ids keep the first entry (a user pinging themselves is synced once).
 */
export function buildSyncBody(users, guildName) {
    const seen = new Set();
    const list = [];
    for (const u of users) {
        if (seen.has(u.discordId)) continue;
        seen.add(u.discordId);
        list.push({
            discord_id: u.discordId,
            discord_username: truncate(u.name, MAX_NAME_LENGTH),
            avatar_url: u.avatarUrl ?? null,
        });
    }
    const body = { users: list };
    const name = nonEmpty(guildName);
    if (name) body.guild_name = truncate(name, MAX_GUILD_NAME_LENGTH);
    return body;
}

/** The when2play user row for `discordId` in a sync response, or null. */
export function findSyncedUser(data, discordId) {
    const users = Array.isArray(data?.users) ? data.users : [];
    return users.find(u => u?.discord_id === discordId && typeof u.id === 'string') ?? null;
}
