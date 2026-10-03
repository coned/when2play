// Periodic retry of guild settings that failed to load (Worker cold start, timeout).
// No side effects on import: no timers until start().

/**
 * Every `intervalMs`, call `load(guildId)` one guild after another for each id returned by
 * `getGuildIds()` (guilds without a cached output channel). `load` rejects on failure.
 * A failure is logged once per guild and error message; a recovery is logged once.
 */
export function createSettingsRetrier({
    getGuildIds,
    load,
    intervalMs = 5 * 60 * 1000,
    logError = () => {},
    consoleLog = () => {},
    consoleError = () => {},
    setTimeout: setTimer = globalThis.setTimeout,
    clearTimeout: clearTimer = globalThis.clearTimeout,
} = {}) {
    const lastFailure = new Map(); // guildId -> last logged error message
    let timer = null;
    let started = false;
    let stopped = false;
    let running = null;

    async function retryGuild(guildId) {
        try {
            await load(guildId);
            if (lastFailure.has(guildId)) {
                lastFailure.delete(guildId);
                consoleLog(`Settings retry: loaded settings for guild ${guildId}`);
            }
        } catch (err) {
            const message = err?.message ?? String(err);
            if (lastFailure.get(guildId) === message) return;
            lastFailure.set(guildId, message);
            logError(`settings retry for guild ${guildId}`, err);
            consoleError(`Settings retry for guild ${guildId} failed (logged once until it changes): ${message}`);
        }
    }

    async function run() {
        const ids = [...new Set(getGuildIds())];
        const wanted = new Set(ids);
        for (const guildId of lastFailure.keys()) {
            if (!wanted.has(guildId)) lastFailure.delete(guildId);
        }
        for (const guildId of ids) {
            if (stopped) break;
            await retryGuild(guildId);
        }
    }

    /** One retry round. Never rejects; concurrent calls share the running round. */
    function runOnce() {
        if (running) return running;
        running = run()
            .catch((err) => logError('settings retry round', err))
            .finally(() => { running = null; });
        return running;
    }

    function scheduleNext() {
        if (!started) return;
        timer = setTimer(async () => {
            timer = null;
            await runOnce();
            scheduleNext();
        }, intervalMs);
    }

    function start() {
        if (started) return;
        started = true;
        stopped = false;
        scheduleNext();
    }

    function stop() {
        started = false;
        stopped = true;
        if (timer !== null) {
            clearTimer(timer);
            timer = null;
        }
    }

    return { start, stop, runOnce };
}
