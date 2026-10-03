import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    createPoller,
    computeDelay,
    fmtDiscordTime,
    formatRallyAction,
    formatTreeShare,
    formatGameShare,
} from '../lib/poller.mjs';

const G1 = '926950608127287346';
const G2 = '1165751530654273707';
const API = 'https://w2p.example.test';

function jsonRes(status, body) {
    return {
        status,
        ok: status >= 200 && status < 300,
        json: async () => body,
        text: async () => JSON.stringify(body),
    };
}

function okData({ guilds = {}, unknown_guilds = [], errors = {} } = {}) {
    return jsonRes(200, { ok: true, data: { guilds, unknown_guilds, errors } });
}

function lists({ rally_actions = [], tree_shares = [], game_shares = [] } = {}) {
    return { rally_actions, tree_shares, game_shares };
}

/** Fake fetch: each call consumes the next scripted response (Error = throw, function = custom). */
function fakeFetch(script = []) {
    const calls = [];
    const fn = async (url, init) => {
        calls.push({ url, init, body: JSON.parse(init.body) });
        const next = script.length ? script.shift() : okData();
        if (next instanceof Error) throw next;
        if (typeof next === 'function') return next();
        return next;
    };
    fn.calls = calls;
    return fn;
}

function fakeTimers() {
    const timers = [];
    return {
        timers,
        setTimeout: (fn, delay) => { const t = { fn, delay, cleared: false }; timers.push(t); return t; },
        clearTimeout: (t) => { if (t) t.cleared = true; },
    };
}

function makePoller({ fetch, guildIds = [G1, G2], deliver = async () => {}, ...rest } = {}) {
    const errors = [];
    const delivered = [];
    const poller = createPoller({
        fetch,
        apiUrl: API,
        getHeaders: () => ({ 'X-Bot-Token': 'secret' }),
        getGuildIds: () => guildIds,
        deliver: async (guildId, kind, item) => {
            await deliver(guildId, kind, item);
            delivered.push(`${guildId}/${kind}/${item.id}`);
        },
        logError: (context, err) => errors.push(`${context}: ${err.message}`),
        ...rest,
    });
    return { poller, errors, delivered };
}

// --- Poller ---

test('one request per cycle carrying all guild ids', async () => {
    const fetch = fakeFetch([okData()]);
    const { poller } = makePoller({ fetch });
    await poller.pollOnce();
    assert.equal(fetch.calls.length, 1);
    const { url, init, body } = fetch.calls[0];
    assert.equal(url, `${API}/api/bot/poll`);
    assert.equal(init.method, 'POST');
    assert.equal(init.headers['Content-Type'], 'application/json');
    assert.equal(init.headers['X-Bot-Token'], 'secret');
    assert.equal(init.headers['X-Guild-Id'], undefined);
    assert.ok(init.signal instanceof AbortSignal);
    assert.deepEqual(body, { guild_ids: [G1, G2] });
});

test('acks ride on the next request and are forgotten after success', async () => {
    const fetch = fakeFetch([
        okData({ guilds: { [G1]: lists({ rally_actions: [{ id: 'a1', action_type: 'in' }], game_shares: [{ id: 'g1' }] }) } }),
        okData(),
        okData(),
    ]);
    const { poller, delivered } = makePoller({ fetch });
    await poller.pollOnce();
    assert.deepEqual(delivered, [`${G1}/rally_actions/a1`, `${G1}/game_shares/g1`]);
    await poller.pollOnce();
    assert.deepEqual(fetch.calls[1].body.acks, { [G1]: { rally_actions: ['a1'], game_shares: ['g1'] } });
    await poller.pollOnce();
    assert.equal(fetch.calls[2].body.acks, undefined);
    assert.deepEqual(poller.pendingAcks, {});
});

test('acks are kept when the request fails', async () => {
    const fetch = fakeFetch([
        okData({ guilds: { [G1]: lists({ tree_shares: [{ id: 't1', day_key: '2026-03-10', image_data: 'aGk=' }] }) } }),
        new TypeError('fetch failed'),
        jsonRes(500, { ok: false }),
        jsonRes(200, { ok: false, error: { code: 'X', message: 'nope' } }),
        okData(),
        okData(),
    ]);
    const { poller } = makePoller({ fetch });
    await poller.pollOnce();
    for (let i = 0; i < 4; i++) await poller.pollOnce();
    for (const call of fetch.calls.slice(1, 5)) {
        assert.deepEqual(call.body.acks, { [G1]: { tree_shares: ['t1'] } });
    }
    await poller.pollOnce();
    assert.equal(fetch.calls[5].body.acks, undefined);
});

test('acks are kept for guilds listed in errors, others forgotten', async () => {
    const fetch = fakeFetch([
        okData({ guilds: {
            [G1]: lists({ rally_actions: [{ id: 'a1', action_type: 'in' }] }),
            [G2]: lists({ rally_actions: [{ id: 'b1', action_type: 'in' }] }),
        } }),
        okData({ errors: { [G1]: 'D1 timeout' } }),
        okData(),
        okData(),
    ]);
    const { poller, errors } = makePoller({ fetch });
    await poller.pollOnce();
    await poller.pollOnce();
    assert.deepEqual(fetch.calls[1].body.acks, {
        [G1]: { rally_actions: ['a1'] },
        [G2]: { rally_actions: ['b1'] },
    });
    assert.ok(errors.some(e => e.includes(`guild ${G1} error: D1 timeout`)));
    await poller.pollOnce();
    assert.deepEqual(fetch.calls[2].body.acks, { [G1]: { rally_actions: ['a1'] } });
    await poller.pollOnce();
    assert.equal(fetch.calls[3].body.acks, undefined);
});

test('acks are dropped for unknown_guilds and each unknown guild is logged once', async () => {
    const fetch = fakeFetch([
        okData({ guilds: { [G2]: lists({ game_shares: [{ id: 'g1' }] }) } }),
        okData({ unknown_guilds: [G2] }),
        okData({ unknown_guilds: [G2] }),
        okData(),
    ]);
    const { poller, errors } = makePoller({ fetch });
    await poller.pollOnce();
    fetch.calls.length = 0;
    await poller.pollOnce();
    assert.deepEqual(fetch.calls[0].body.acks, { [G2]: { game_shares: ['g1'] } });
    await poller.pollOnce();
    await poller.pollOnce();
    assert.equal(fetch.calls[2].body.acks, undefined);
    assert.equal(errors.filter(e => e.includes(`unknown guild ${G2}`)).length, 1);
});

test('unknown guild acks are dropped even when they would otherwise be kept', async () => {
    const fetch = fakeFetch([
        okData({ guilds: { [G2]: lists({ game_shares: [{ id: 'g1' }] }) } }),
        okData({ errors: { [G2]: 'boom' } }),
        okData({ unknown_guilds: [G2], errors: { [G2]: 'boom' } }),
        okData(),
    ]);
    const { poller } = makePoller({ fetch });
    await poller.pollOnce();
    await poller.pollOnce();
    await poller.pollOnce();
    assert.deepEqual(fetch.calls[2].body.acks, { [G2]: { game_shares: ['g1'] } });
    await poller.pollOnce();
    assert.equal(fetch.calls[3].body.acks, undefined);
});

test('a failed delivery is not acked, is retried, and is acked after the third failure', async () => {
    const item = { id: 'a1', action_type: 'call' };
    const pending = () => okData({ guilds: { [G1]: lists({ rally_actions: [item] }) } });
    const fetch = fakeFetch([pending(), pending(), pending(), okData()]);
    let attempts = 0;
    const { poller, errors } = makePoller({
        fetch,
        deliver: async () => { attempts++; throw new Error('Missing Access'); },
    });
    await poller.pollOnce();
    await poller.pollOnce();
    assert.equal(fetch.calls[1].body.acks, undefined);
    await poller.pollOnce();
    assert.equal(fetch.calls[2].body.acks, undefined);
    assert.equal(attempts, 3);
    await poller.pollOnce();
    assert.deepEqual(fetch.calls[3].body.acks, { [G1]: { rally_actions: ['a1'] } });
    assert.equal(errors.filter(e => e.includes('rally_actions a1')).length, 3);
    assert.ok(errors[2].includes('giving up'));
});

test('a delivery that succeeds on retry is acked normally', async () => {
    const item = { id: 'g9' };
    const pending = () => okData({ guilds: { [G1]: lists({ game_shares: [item] }) } });
    const fetch = fakeFetch([pending(), pending(), okData()]);
    let attempts = 0;
    const { poller, delivered } = makePoller({
        fetch,
        deliver: async () => { if (++attempts === 1) throw new Error('rate limited'); },
    });
    await poller.pollOnce();
    await poller.pollOnce();
    assert.deepEqual(delivered, [`${G1}/game_shares/g9`]);
    await poller.pollOnce();
    assert.deepEqual(fetch.calls[2].body.acks, { [G1]: { game_shares: ['g9'] } });
});

test('one failing item does not block the others', async () => {
    const fetch = fakeFetch([
        okData({ guilds: {
            [G1]: lists({
                rally_actions: [{ id: 'a1' }, { id: 'bad' }, { id: 'a3' }],
                tree_shares: [{ id: 't1', image_data: 'aGk=' }],
            }),
            [G2]: lists({ game_shares: [{ id: 'g1' }] }),
        } }),
        okData(),
    ]);
    const { poller, delivered } = makePoller({
        fetch,
        deliver: async (_g, _k, item) => { if (item.id === 'bad') throw new Error('boom'); },
    });
    await poller.pollOnce();
    assert.deepEqual(delivered.sort(), [
        `${G1}/rally_actions/a1`,
        `${G1}/rally_actions/a3`,
        `${G1}/tree_shares/t1`,
        `${G2}/game_shares/g1`,
    ].sort());
    await poller.pollOnce();
    assert.deepEqual(fetch.calls[1].body.acks, {
        [G1]: { rally_actions: ['a1', 'a3'], tree_shares: ['t1'] },
        [G2]: { game_shares: ['g1'] },
    });
});

test('an item already waiting for its ack is not delivered twice', async () => {
    const item = { id: 'a1', action_type: 'in' };
    const fetch = fakeFetch([
        okData({ guilds: { [G1]: lists({ rally_actions: [item] }) } }),
        okData({ guilds: { [G1]: lists({ rally_actions: [item] }) }, errors: { [G1]: 'partial' } }),
    ]);
    const { poller, delivered } = makePoller({ fetch });
    await poller.pollOnce();
    await poller.pollOnce();
    assert.deepEqual(delivered, [`${G1}/rally_actions/a1`]);
});

test('never sends more than 200 ids per list; the rest follows next cycle, logged once', async () => {
    const items = Array.from({ length: 250 }, (_, i) => ({ id: `a${i}` }));
    const fetch = fakeFetch([
        okData({ guilds: { [G1]: lists({ rally_actions: items }) } }),
        okData(),
        okData(),
        okData(),
    ]);
    const { poller, errors } = makePoller({ fetch });
    await poller.pollOnce();
    await poller.pollOnce();
    const first = fetch.calls[1].body.acks[G1].rally_actions;
    assert.equal(first.length, 200);
    assert.deepEqual(first, items.slice(0, 200).map(i => i.id));
    await poller.pollOnce();
    assert.deepEqual(fetch.calls[2].body.acks[G1].rally_actions, items.slice(200).map(i => i.id));
    await poller.pollOnce();
    assert.equal(fetch.calls[3].body.acks, undefined);
    assert.equal(errors.filter(e => e.includes('request limits reached')).length, 1);
});

test('never sends more than 100 guilds per request and rotates through the rest', async () => {
    const guildIds = Array.from({ length: 150 }, (_, i) => String(100000000000000000n + BigInt(i)));
    const fetch = fakeFetch([okData(), okData()]);
    const { poller } = makePoller({ fetch, guildIds });
    await poller.pollOnce();
    await poller.pollOnce();
    assert.deepEqual(fetch.calls[0].body.guild_ids, guildIds.slice(0, 100));
    assert.equal(fetch.calls[1].body.guild_ids.length, 100);
    assert.deepEqual(fetch.calls[1].body.guild_ids.slice(0, 50), guildIds.slice(100));
});

test('backoff delays double per consecutive failure, cap at the max, reset on success', async () => {
    const timers = fakeTimers();
    const fetch = fakeFetch([
        new Error('down'), new Error('down'), new Error('down'), new Error('down'), new Error('down'),
        okData(),
    ]);
    const { poller, errors } = makePoller({
        fetch,
        baseIntervalMs: 1000,
        maxIntervalMs: 8000,
        setTimeout: timers.setTimeout,
        clearTimeout: timers.clearTimeout,
    });
    poller.start();
    for (let i = 0; i < 6; i++) await timers.timers[i].fn();
    assert.deepEqual(timers.timers.map(t => t.delay), [1000, 1000, 2000, 4000, 8000, 8000, 1000]);
    assert.equal(errors[0], 'poll request (errors: 1): down');
    assert.equal(errors[4], 'poll request (errors: 5): down');
    poller.stop();
    assert.equal(timers.timers.at(-1).cleared, true);
});

test('computeDelay with the production defaults', () => {
    assert.equal(computeDelay(0, 15000, 120000), 15000);
    assert.equal(computeDelay(1, 15000, 120000), 15000);
    assert.equal(computeDelay(2, 15000, 120000), 30000);
    assert.equal(computeDelay(4, 15000, 120000), 120000);
    assert.equal(computeDelay(10, 15000, 120000), 120000);
});

test('no overlapping polls: concurrent calls share one request, next timer only after finish', async () => {
    const timers = fakeTimers();
    let release;
    const gate = new Promise(r => { release = r; });
    const fetch = fakeFetch([async () => { await gate; return okData(); }]);
    const { poller } = makePoller({ fetch, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout });
    poller.start();
    poller.start();
    assert.equal(timers.timers.length, 1);
    const running = timers.timers[0].fn();
    const second = poller.pollOnce();
    await Promise.resolve();
    assert.equal(fetch.calls.length, 1);
    assert.equal(timers.timers.length, 1);
    release();
    await running;
    await second;
    assert.equal(fetch.calls.length, 1);
    assert.equal(timers.timers.length, 2);
    poller.stop();
});

test('stop prevents further scheduling', async () => {
    const timers = fakeTimers();
    const fetch = fakeFetch([okData()]);
    const { poller } = makePoller({ fetch, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout });
    poller.start();
    const fire = timers.timers[0].fn;
    poller.stop();
    await fire();
    assert.equal(timers.timers.length, 1);
});

test('HTTP 404 says the Worker must be deployed first', async () => {
    const fetch = fakeFetch([jsonRes(404, { ok: false })]);
    const consoleLines = [];
    const { poller, errors } = makePoller({ fetch, consoleError: (...a) => consoleLines.push(a) });
    await poller.pollOnce();
    assert.equal(errors.length, 1);
    assert.match(errors[0], /Worker is older than the bot and must be deployed first/);
    assert.equal(consoleLines.length, 1);
    assert.equal(poller.consecutiveFailures, 1);
});

test('guild errors are logged first, then at most once per 10 minutes per guild', async () => {
    let clock = 0;
    const err = () => okData({ errors: { [G1]: 'D1 down' } });
    const fetch = fakeFetch([err(), err(), err(), err()]);
    const { poller, errors } = makePoller({ fetch, now: () => clock });
    await poller.pollOnce();
    clock += 60_000;
    await poller.pollOnce();
    clock += 8 * 60_000;
    await poller.pollOnce();
    assert.equal(errors.length, 1);
    clock += 60_000;
    await poller.pollOnce();
    assert.equal(errors.length, 2);
});

test('importing lib/poller.mjs creates no timers or handles', async () => {
    const before = process.getActiveResourcesInfo().length;
    await import(`../lib/poller.mjs?fresh=${Date.now()}`);
    assert.equal(process.getActiveResourcesInfo().length, before);
});

// --- Formatters (expected strings derived from the pre-refactor bot.mjs) ---

const T18 = '<t:1773165600:t>';
const T20 = '<t:1773172800:t>';
const T21 = '<t:1773176400:t>';
const T2230 = '<t:1773181800:t>';
const U1 = '123456789012345678';
const U2 = '98765432109876543';

test('fmtDiscordTime', () => {
    assert.equal(fmtDiscordTime('18:00', '2026-03-10'), T18);
});

test('rally: call, in, out, brb with and without message', () => {
    const r = (action_type, message) => formatRallyAction({ id: 'x', action_type, actor_username: 'alice', message, metadata: null, target_discord_ids: null });
    assert.equal(r('call').text, '📢 **alice** called');
    assert.equal(r('call', 'go').text, '📢 **alice** called -- "go"');
    assert.equal(r('in').text, '✅ **alice** is in!');
    assert.equal(r('in', 'hi').text, '✅ **alice** is in -- "hi"');
    assert.equal(r('out').text, '❌ **alice** is out');
    assert.equal(r('out', 'tired').text, '❌ **alice** is out -- "tired"');
    assert.equal(r('brb').text, '⏳ **alice** brb');
    assert.equal(r('brb', '5 min').text, '⏳ **alice** brb -- "5 min"');
    assert.deepEqual(r('call').mentionUsers, []);
});

test('rally: anonymous actor', () => {
    const { text } = formatRallyAction({ action_type: 'call', actor_username: 'alice', message: null, metadata: { is_anonymous: true } });
    assert.equal(text, '📢 **Someone** called');
    const jt = formatRallyAction({ action_type: 'judge_time', actor_username: 'alice', metadata: { is_anonymous: true } });
    assert.equal(jt.text, '🤖 No overlapping availability found today. Ask everyone to set their times!\n_On behalf of Someone_');
});

test('rally: ping and where with targets, mention filter, and no targets', () => {
    const ping = formatRallyAction({ action_type: 'ping', actor_username: 'bob', message: 'come', target_discord_ids: [U1, U2, 'abc'] });
    assert.equal(ping.text, `👋 **bob** → <@${U1}>, <@${U2}>, <@abc> -- "come"`);
    assert.deepEqual(ping.mentionUsers, [U1, U2]);
    const pingNone = formatRallyAction({ action_type: 'ping', actor_username: 'bob', target_discord_ids: null });
    assert.equal(pingNone.text, '👋 **bob** → someone');
    assert.deepEqual(pingNone.mentionUsers, []);
    const where = formatRallyAction({ action_type: 'where', actor_username: 'bob', target_discord_ids: [U1] });
    assert.equal(where.text, `❓ **bob** → <@${U1}>`);
    assert.deepEqual(where.mentionUsers, [U1]);
    const whereMsg = formatRallyAction({ action_type: 'where', actor_username: 'bob', message: 'hello?', target_discord_ids: null });
    assert.equal(whereMsg.text, '❓ **bob** → someone -- "hello?"');
});

test('rally: judge_avail with default and custom message', () => {
    const a = formatRallyAction({ action_type: 'judge_avail', actor_username: 'bob', message: null, target_discord_ids: [U1] });
    assert.equal(a.text, `🤖 **bob** → <@${U1}>: Please set your availability!`);
    assert.deepEqual(a.mentionUsers, [U1]);
    const b = formatRallyAction({ action_type: 'judge_avail', actor_username: 'bob', message: 'pick times', target_discord_ids: null });
    assert.equal(b.text, '🤖 **bob** → someone: pick times');
});

test('rally: judge_time with windows', () => {
    const { text } = formatRallyAction({
        action_type: 'judge_time',
        actor_username: 'bob',
        metadata: {
            day_key: '2026-03-10',
            windows: [
                { start: '18:00', end: '20:00', user_names: [' ann ', 'cid'], user_count: 2 },
                { start: '21:00', end: '22:30', user_count: 3 },
            ],
        },
    });
    assert.equal(text,
        `📅 **Best window:** ${T18}--${T20} (ann, cid)\n`
        + '📋 **All windows today (2):**\n'
        + `• ${T18}--${T20}: ann, cid\n`
        + `• ${T21}--${T2230}: 3 people\n`
        + '_On behalf of bob_');
});

test('rally: judge_time lists at most 8 windows', () => {
    const windows = Array.from({ length: 10 }, () => ({ start: '18:00', end: '20:00', user_count: 1 }));
    const { text } = formatRallyAction({ action_type: 'judge_time', actor_username: 'bob', metadata: { day_key: '2026-03-10', windows } });
    assert.match(text, /All windows today \(10\)/);
    assert.equal(text.split('\n').filter(l => l.startsWith('• ')).length, 8);
});

test('rally: judge_time without windows', () => {
    const { text } = formatRallyAction({ action_type: 'judge_time', actor_username: 'bob', metadata: { day_key: '2026-03-10', windows: [] } });
    assert.equal(text, '🤖 No overlapping availability found today. Ask everyone to set their times!\n_On behalf of bob_');
});

test('rally: share_ranking with and without games', () => {
    const withGames = formatRallyAction({
        action_type: 'share_ranking',
        actor_username: 'bob',
        metadata: { ranking: [
            { name: 'Dota 2', steam_app_id: 570, total_score: 10, vote_count: 3, like_count: 2 },
            { name: 'Chess', steam_app_id: null, total_score: 5, vote_count: 1, like_count: 0 },
        ] },
    });
    assert.equal(withGames.text,
        '🏆 **Game Rankings:**\n'
        + '#1 [Dota 2](https://store.steampowered.com/app/570/) (10 pts, 3 votes, 2 likes)\n'
        + '#2 Chess (5 pts, 1 votes)\n'
        + '_On behalf of bob_');
    const empty = formatRallyAction({ action_type: 'share_ranking', actor_username: 'bob', metadata: { ranking: [] } });
    assert.equal(empty.text, '🏆 **bob** shared rankings -- no games ranked yet');
    const noMeta = formatRallyAction({ action_type: 'share_ranking', actor_username: 'bob', metadata: null });
    assert.equal(noMeta.text, '🏆 **bob** shared rankings -- no games ranked yet');
});

test('rally: unknown action type falls back to the default line', () => {
    assert.equal(formatRallyAction({ action_type: 'mystery', actor_username: 'bob' }).text, '**bob**: mystery');
});

test('game share text and embed', () => {
    const full = formatGameShare({
        id: 'g1', game_name: 'Hades', game_note: 'roguelike', game_image_url: 'https://img.example/h.jpg',
        game_steam_app_id: 1145360, like_count: 3, dislike_count: 1, requester_name: 'carol',
    });
    assert.equal(full.content, '**Hades**\n> roguelike\nScore: +2 (3 likes, 1 dislike) | Steam: https://store.steampowered.com/app/1145360/\n_Shared by carol_');
    assert.deepEqual(full.embeds, [{ image: { url: 'https://img.example/h.jpg' }, color: 0x4a9eff }]);

    const minimal = formatGameShare({ id: 'g2', game_name: 'Chess', requester_name: 'dan' });
    assert.equal(minimal.content, '**Chess**\n_Shared by dan_');
    assert.equal(minimal.embeds, null);

    const negative = formatGameShare({ game_name: 'X', like_count: 1, dislike_count: 2, requester_name: 'e' });
    assert.equal(negative.content, '**X**\nScore: -1 (1 like, 2 dislikes)\n_Shared by e_');
    const even = formatGameShare({ game_name: 'Y', like_count: 1, dislike_count: 1, requester_name: 'f' });
    assert.equal(even.content, '**Y**\nScore: 0 (1 like, 1 dislike)\n_Shared by f_');
    const steamOnly = formatGameShare({ game_name: 'Z', game_steam_app_id: 10, like_count: 0, dislike_count: 0, requester_name: 'g' });
    assert.equal(steamOnly.content, '**Z**\nSteam: https://store.steampowered.com/app/10/\n_Shared by g_');
});

test('tree share caption and file name', () => {
    assert.deepEqual(formatTreeShare({ id: 't1', day_key: '2026-03-10', image_data: 'aGk=' }), {
        content: '📊 **Gaming Tree** -- 2026-03-10',
        fileName: 'gaming-tree-2026-03-10.png',
    });
    assert.equal(formatTreeShare({ id: 't2', day_key: '2026-03-10', image_data: '' }), null);
});
