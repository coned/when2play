// Aggregated delivery poller for POST /api/bot/poll plus the pure message formatters.
// No side effects on import: no discord.js, no env reads, no timers until start().

export const KINDS = ['rally_actions', 'tree_shares', 'game_shares'];
export const MAX_GUILDS_PER_REQUEST = 100;
export const MAX_IDS_PER_LIST = 200;

// Convert a UTC HH:MM time + YYYY-MM-DD day_key to a Discord timestamp token
// that renders in each viewer's local timezone automatically.
export function fmtDiscordTime(utcHHMM, dayKey) {
    const ts = Math.floor(new Date(`${dayKey}T${utcHHMM}:00Z`).getTime() / 1000);
    return `<t:${ts}:t>`;
}

/** Rally action -> { text, mentionUsers }. */
export function formatRallyAction(action) {
    // Use bold plaintext name instead of @mention to avoid pinging the sender
    const isAnon = action.metadata?.is_anonymous === true;
    const actor = isAnon ? '**Someone**' : `**${action.actor_username}**`;
    const actorPlain = isAnon ? 'Someone' : action.actor_username;
    let text = '';

    switch (action.action_type) {
        case 'call':
            text = `📢 ${actor} called${action.message ? ` -- "${action.message}"` : ''}`;
            break;
        case 'in':
            text = `✅ ${actor} is in${action.message ? ` -- "${action.message}"` : '!'}`;
            break;
        case 'out':
            text = `❌ ${actor} is out${action.message ? ` -- "${action.message}"` : ''}`;
            break;
        case 'ping': {
            const targets = action.target_discord_ids?.map(id => `<@${id}>`).join(', ') ?? 'someone';
            text = `👋 ${actor} → ${targets}${action.message ? ` -- "${action.message}"` : ''}`;
            break;
        }
        case 'judge_time': {
            const meta = action.metadata;
            if (meta?.windows?.length > 0) {
                const fmtNames = (w) => (w.user_names?.map(n => n.trim()).join(', ') ?? `${w.user_count} people`);
                const fmt = (t) => fmtDiscordTime(t, meta.day_key);
                const best = meta.windows[0];
                text = `📅 **Best window:** ${fmt(best.start)}--${fmt(best.end)} (${fmtNames(best)})`;
                const allLines = meta.windows.slice(0, 8).map(w => `• ${fmt(w.start)}--${fmt(w.end)}: ${fmtNames(w)}`);
                text += `\n📋 **All windows today (${meta.windows.length}):**\n${allLines.join('\n')}`;
                text += `\n_On behalf of ${actorPlain}_`;
            } else {
                text = `🤖 No overlapping availability found today. Ask everyone to set their times!\n_On behalf of ${actorPlain}_`;
            }
            break;
        }
        case 'judge_avail': {
            const targets = action.target_discord_ids?.map(id => `<@${id}>`).join(', ') ?? 'someone';
            const nudgeMsg = action.message || 'Please set your availability!';
            text = `🤖 ${actor} → ${targets}: ${nudgeMsg}`;
            break;
        }
        case 'brb':
            text = `⏳ ${actor} brb${action.message ? ` -- "${action.message}"` : ''}`;
            break;
        case 'where': {
            const targets = action.target_discord_ids?.map(id => `<@${id}>`).join(', ') ?? 'someone';
            text = `❓ ${actor} → ${targets}${action.message ? ` -- "${action.message}"` : ''}`;
            break;
        }
        case 'share_ranking': {
            const meta = action.metadata;
            if (meta?.ranking?.length > 0) {
                const lines = meta.ranking.map((r, i) => {
                    const name = r.steam_app_id
                        ? `[${r.name}](https://store.steampowered.com/app/${r.steam_app_id}/)`
                        : r.name;
                    const likes = r.like_count ? `, ${r.like_count} likes` : '';
                    return `#${i + 1} ${name} (${r.total_score} pts, ${r.vote_count} votes${likes})`;
                });
                text = `🏆 **Game Rankings:**\n${lines.join('\n')}\n_On behalf of ${actorPlain}_`;
            } else {
                text = `🏆 ${actor} shared rankings -- no games ranked yet`;
            }
            break;
        }
        default:
            text = `${actor}: ${action.action_type}`;
    }

    const mentionUsers = (action.target_discord_ids ?? []).filter(id => /^\d{17,20}$/.test(id));
    return { text, mentionUsers };
}

/** Tree share -> { content, fileName }, or null when there is no image to post. */
export function formatTreeShare(share) {
    if (!share.image_data) return null;
    return {
        content: `📊 **Gaming Tree** -- ${share.day_key}`,
        fileName: `gaming-tree-${share.day_key}.png`,
    };
}

/** Game share -> { content, embeds } (embeds is null when there is no image). */
export function formatGameShare(share) {
    const likes = share.like_count ?? 0;
    const dislikes = share.dislike_count ?? 0;
    const net = likes - dislikes;
    const scoreStr = net > 0 ? `+${net}` : String(net);

    let text = `**${share.game_name}**`;
    if (share.game_note) text += `\n> ${share.game_note}`;
    const steamUrl = share.game_steam_app_id ? `https://store.steampowered.com/app/${share.game_steam_app_id}/` : null;
    const stats = [];
    if (likes > 0 || dislikes > 0) stats.push(`Score: ${scoreStr} (${likes} like${likes !== 1 ? 's' : ''}, ${dislikes} dislike${dislikes !== 1 ? 's' : ''})`);
    if (steamUrl) stats.push(`Steam: ${steamUrl}`);
    if (stats.length > 0) text += `\n${stats.join(' | ')}`;
    text += `\n_Shared by ${share.requester_name}_`;

    // Embed the Steam header image
    const embeds = share.game_image_url ? [{ image: { url: share.game_image_url }, color: 0x4a9eff }] : null;
    return { content: text, embeds };
}

/** Delay before the next poll given the number of consecutive request failures. */
export function computeDelay(failures, baseMs, maxMs) {
    if (failures <= 0) return baseMs;
    return Math.min(baseMs * Math.pow(2, failures - 1), maxMs);
}

export function createPoller({
    fetch: fetchFn,
    apiUrl,
    getHeaders = () => ({}),
    getGuildIds,
    deliver,
    logError = () => {},
    consoleError = () => {},
    baseIntervalMs = 15_000,
    maxIntervalMs = 2 * 60 * 1000,
    requestTimeoutMs = 20_000,
    maxDeliveryAttempts = 3,
    guildErrorLogIntervalMs = 10 * 60 * 1000,
    now = Date.now,
    setTimeout: setTimer = globalThis.setTimeout,
    clearTimeout: clearTimer = globalThis.clearTimeout,
} = {}) {
    const pollUrl = `${apiUrl}/api/bot/poll`;
    const pendingAcks = new Map(); // guildId -> { kind: Set<id> }
    const failCounts = new Map(); // `${guildId}|${kind}|${id}` -> { count, at }
    const loggedUnknown = new Set();
    const lastGuildErrorLog = new Map();
    let consecutiveFailures = 0;
    let guildCursor = 0;
    let capLogged = false;
    let inFlight = null;
    let timer = null;
    let started = false;

    function ackSet(guildId, kind) {
        let entry = pendingAcks.get(guildId);
        if (!entry) {
            entry = Object.fromEntries(KINDS.map(k => [k, new Set()]));
            pendingAcks.set(guildId, entry);
        }
        return entry[kind];
    }

    function queueAck(guildId, kind, id) {
        ackSet(guildId, kind).add(id);
    }

    function isQueued(guildId, kind, id) {
        return pendingAcks.get(guildId)?.[kind]?.has(id) ?? false;
    }

    /** Pending acks within the request limits: { acks, ackGuilds, truncated }. */
    function collectAcks() {
        let truncated = false;
        const acks = {};
        let ackGuilds = 0;
        for (const [guildId, entry] of pendingAcks) {
            const lists = {};
            for (const kind of KINDS) {
                if (entry[kind].size === 0) continue;
                const ids = [...entry[kind]];
                if (ids.length > MAX_IDS_PER_LIST) {
                    truncated = true;
                    ids.length = MAX_IDS_PER_LIST;
                }
                lists[kind] = ids;
            }
            if (Object.keys(lists).length === 0) continue;
            if (ackGuilds >= MAX_GUILDS_PER_REQUEST) {
                truncated = true;
                break;
            }
            acks[guildId] = lists;
            ackGuilds++;
        }
        return { acks, ackGuilds, truncated };
    }

    function buildRequest() {
        let truncated = false;
        let guildIds = [...new Set(getGuildIds())];
        if (guildIds.length > MAX_GUILDS_PER_REQUEST) {
            truncated = true;
            const start = guildCursor % guildIds.length;
            guildIds = [...guildIds.slice(start), ...guildIds.slice(0, start)].slice(0, MAX_GUILDS_PER_REQUEST);
            guildCursor = start + MAX_GUILDS_PER_REQUEST;
        } else {
            guildCursor = 0;
        }

        const collected = collectAcks();
        const { acks, ackGuilds } = collected;
        truncated = truncated || collected.truncated;

        if (truncated && !capLogged) {
            capLogged = true;
            const err = new Error(`request limits reached (${MAX_GUILDS_PER_REQUEST} guilds, ${MAX_IDS_PER_LIST} ids per list); the rest is sent in following cycles`);
            logError('poll', err);
            consoleError('Poll request truncated:', err.message);
        } else if (!truncated) {
            capLogged = false;
        }

        const body = { guild_ids: guildIds };
        if (ackGuilds > 0) body.acks = acks;
        return { body, sentAcks: acks };
    }

    function forgetSentAcks(sentAcks, keepGuilds) {
        for (const [guildId, lists] of Object.entries(sentAcks)) {
            if (keepGuilds.has(guildId)) continue;
            const entry = pendingAcks.get(guildId);
            if (!entry) continue;
            for (const [kind, ids] of Object.entries(lists)) {
                for (const id of ids) entry[kind].delete(id);
            }
            if (KINDS.every(k => entry[k].size === 0)) pendingAcks.delete(guildId);
        }
    }

    async function request(body, timeoutMs = requestTimeoutMs) {
        const res = await fetchFn(pollUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getHeaders() },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(timeoutMs),
        });
        if (res.status === 404) {
            throw new Error('HTTP 404 from /api/bot/poll: the Worker is older than the bot and must be deployed first');
        }
        if (res.status !== 200) {
            const text = await res.text().catch(() => '');
            throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
        }
        const json = await res.json();
        if (json?.ok !== true) {
            throw new Error(`poll returned ok=${json?.ok}: ${json?.error?.message ?? 'no error message'}`);
        }
        return json.data ?? {};
    }

    function logGuildIssues(unknownGuilds, errors) {
        for (const guildId of unknownGuilds) {
            if (loggedUnknown.has(guildId)) continue;
            loggedUnknown.add(guildId);
            const err = new Error('the server has no database for this guild');
            logError(`poll: unknown guild ${guildId}`, err);
            consoleError(`Poll: unknown guild ${guildId}: ${err.message}`);
        }
        const t = now();
        for (const [guildId, message] of Object.entries(errors)) {
            const last = lastGuildErrorLog.get(guildId);
            if (last !== undefined && t - last < guildErrorLogIntervalMs) continue;
            lastGuildErrorLog.set(guildId, t);
            const err = new Error(String(message));
            logError(`poll: guild ${guildId} error`, err);
            consoleError(`Poll: server error for guild ${guildId}: ${err.message}`);
        }
    }

    async function deliverOne(guildId, kind, item) {
        const id = item?.id;
        if (id === undefined || id === null) return;
        // Already delivered and waiting for its ack: never post it twice
        if (isQueued(guildId, kind, id)) return;
        const key = `${guildId}|${kind}|${id}`;
        try {
            await deliver(guildId, kind, item);
            failCounts.delete(key);
            queueAck(guildId, kind, id);
        } catch (err) {
            const count = (failCounts.get(key)?.count ?? 0) + 1;
            if (count >= maxDeliveryAttempts) {
                failCounts.delete(key);
                queueAck(guildId, kind, id);
                logError(`deliver ${kind} ${id} for guild ${guildId} (attempt ${count}/${maxDeliveryAttempts}, giving up and acking)`, err);
                consoleError(`Giving up on ${kind} ${id} for guild ${guildId} after ${count} attempts:`, err);
            } else {
                failCounts.set(key, { count, at: now() });
                logError(`deliver ${kind} ${id} for guild ${guildId} (attempt ${count}/${maxDeliveryAttempts})`, err);
                consoleError(`Error delivering ${kind} ${id} for guild ${guildId} (attempt ${count}/${maxDeliveryAttempts}):`, err);
            }
        }
    }

    async function deliverGuild(guildId, lists) {
        for (const kind of KINDS) {
            const items = Array.isArray(lists?.[kind]) ? lists[kind] : [];
            for (const item of items) await deliverOne(guildId, kind, item);
        }
    }

    function pruneFailCounts() {
        // The server drops items after 30 minutes, so older failure counters are dead weight
        const cutoff = now() - 60 * 60 * 1000;
        for (const [key, value] of failCounts) {
            if (value.at < cutoff) failCounts.delete(key);
        }
    }

    /** Forget acks the Worker applied; keep them for guilds it reported an error for. */
    function applyAckResult(data, sentAcks) {
        const unknownGuilds = Array.isArray(data.unknown_guilds) ? data.unknown_guilds : [];
        const errors = data.errors && typeof data.errors === 'object' ? data.errors : {};
        forgetSentAcks(sentAcks, new Set(Object.keys(errors)));
        for (const guildId of unknownGuilds) pendingAcks.delete(guildId);
        logGuildIssues(unknownGuilds, errors);
    }

    async function runPoll() {
        const { body, sentAcks } = buildRequest();
        let data;
        try {
            data = await request(body);
        } catch (err) {
            consecutiveFailures++;
            logError(`poll request (errors: ${consecutiveFailures})`, err);
            consoleError(`Error polling (errors: ${consecutiveFailures}):`, err);
            return;
        }
        consecutiveFailures = 0;

        const guilds = data.guilds && typeof data.guilds === 'object' ? data.guilds : {};
        applyAckResult(data, sentAcks);

        await Promise.all(Object.entries(guilds).map(([guildId, lists]) => deliverGuild(guildId, lists)));
        pruneFailCounts();
    }

    /** Run one poll cycle. Never rejects; concurrent calls share the in-flight cycle. */
    function pollOnce() {
        if (inFlight) return inFlight;
        inFlight = runPoll()
            .catch((err) => {
                logError('poll cycle', err);
                consoleError('Unexpected error in poll cycle:', err);
            })
            .finally(() => { inFlight = null; });
        return inFlight;
    }

    async function runFlush(timeoutMs) {
        const { acks, ackGuilds } = collectAcks();
        if (ackGuilds === 0) return true;
        let data;
        try {
            // guild_ids is empty: nothing is fetched for delivery, the Worker only applies the acks
            data = await request({ guild_ids: [], acks }, timeoutMs);
        } catch (err) {
            logError('flush acks', err);
            consoleError('Error flushing acks:', err);
            return false;
        }
        applyAckResult(data, acks);
        return true;
    }

    /**
     * Send the pending acks in one request without fetching anything to deliver (for shutdown).
     * Waits for an in-flight cycle first. Never rejects: resolves true when there was nothing to
     * send or the request succeeded, false when it failed (the acks stay pending).
     */
    async function flushAcks({ timeoutMs = requestTimeoutMs } = {}) {
        while (inFlight) await inFlight;
        inFlight = runFlush(timeoutMs)
            .catch((err) => {
                logError('flush acks', err);
                consoleError('Unexpected error flushing acks:', err);
                return false;
            })
            .finally(() => { inFlight = null; });
        return inFlight;
    }

    function nextDelay() {
        return computeDelay(consecutiveFailures, baseIntervalMs, maxIntervalMs);
    }

    function scheduleNext(delay) {
        if (!started) return;
        timer = setTimer(async () => {
            timer = null;
            await pollOnce();
            scheduleNext(nextDelay());
        }, delay);
    }

    function start() {
        if (started) return;
        started = true;
        scheduleNext(baseIntervalMs);
    }

    function stop() {
        started = false;
        if (timer !== null) {
            clearTimer(timer);
            timer = null;
        }
    }

    return {
        pollOnce,
        flushAcks,
        start,
        stop,
        nextDelay,
        get consecutiveFailures() { return consecutiveFailures; },
        get pendingAcks() {
            const out = {};
            for (const [guildId, entry] of pendingAcks) {
                out[guildId] = Object.fromEntries(KINDS.map(k => [k, [...entry[k]]]));
            }
            return out;
        },
    };
}
