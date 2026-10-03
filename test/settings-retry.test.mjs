import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSettingsRetrier } from '../lib/settings-retry.mjs';

function fakeTimers() {
    const timers = [];
    return {
        timers,
        setTimeout: (fn, delay) => { const t = { fn, delay, cleared: false }; timers.push(t); return t; },
        clearTimeout: (t) => { if (t) t.cleared = true; },
    };
}

function makeRetrier({ ids = ['g1', 'g2'], load, ...rest } = {}) {
    const errors = [];
    const logs = [];
    const timers = fakeTimers();
    const state = { ids };
    const retrier = createSettingsRetrier({
        getGuildIds: () => state.ids,
        load,
        logError: (context, err) => errors.push(`${context}: ${err.message}`),
        consoleLog: (line) => logs.push(line),
        setTimeout: timers.setTimeout,
        clearTimeout: timers.clearTimeout,
        ...rest,
    });
    return { retrier, errors, logs, timers, state };
}

test('loads guilds one after another, never in parallel', async () => {
    let active = 0;
    let maxActive = 0;
    const order = [];
    const { retrier } = makeRetrier({
        ids: ['g1', 'g2', 'g3'],
        load: async (id) => {
            active++;
            maxActive = Math.max(maxActive, active);
            order.push(id);
            await new Promise(r => setImmediate(r));
            active--;
        },
    });
    await retrier.runOnce();
    assert.deepEqual(order, ['g1', 'g2', 'g3']);
    assert.equal(maxActive, 1);
});

test('the same failure is logged once, a new message again, recovery once', async () => {
    let message = 'timeout';
    let fail = true;
    const { retrier, errors, logs } = makeRetrier({
        ids: ['g1'],
        load: async () => { if (fail) throw new Error(message); },
    });
    await retrier.runOnce();
    await retrier.runOnce();
    await retrier.runOnce();
    assert.deepEqual(errors, ['settings retry for guild g1: timeout']);
    message = 'HTTP 500';
    await retrier.runOnce();
    assert.equal(errors.length, 2);
    fail = false;
    await retrier.runOnce();
    await retrier.runOnce();
    assert.equal(logs.length, 1);
    assert.match(logs[0], /loaded settings for guild g1/);
});

test('one failing guild does not stop the others', async () => {
    const loaded = [];
    const { retrier } = makeRetrier({
        ids: ['bad', 'g2'],
        load: async (id) => { if (id === 'bad') throw new Error('x'); loaded.push(id); },
    });
    await retrier.runOnce();
    assert.deepEqual(loaded, ['g2']);
});

test('runs every interval after start, the next round only after the previous one ends', async () => {
    let calls = 0;
    const { retrier, timers } = makeRetrier({ ids: ['g1'], load: async () => { calls++; }, intervalMs: 300_000 });
    retrier.start();
    retrier.start();
    assert.equal(timers.timers.length, 1);
    assert.equal(timers.timers[0].delay, 300_000);
    assert.equal(calls, 0);
    await timers.timers[0].fn();
    assert.equal(calls, 1);
    assert.equal(timers.timers.length, 2);
    retrier.stop();
    assert.equal(timers.timers[1].cleared, true);
});

test('stop prevents further rounds and ends a running round early', async () => {
    const loaded = [];
    const { retrier, timers } = makeRetrier({
        ids: ['g1', 'g2'],
        load: async (id) => { loaded.push(id); if (id === 'g1') retrier.stop(); },
    });
    retrier.start();
    await timers.timers[0].fn();
    assert.deepEqual(loaded, ['g1']);
    assert.equal(timers.timers.length, 1);
});

test('no guilds to retry means no requests', async () => {
    let calls = 0;
    const { retrier } = makeRetrier({ ids: [], load: async () => { calls++; } });
    await retrier.runOnce();
    assert.equal(calls, 0);
});

test('a throwing getGuildIds is logged and the round resolves', async () => {
    const { retrier, errors } = makeRetrier({ load: async () => {} });
    const broken = createSettingsRetrier({
        getGuildIds: () => { throw new Error('no cache'); },
        load: async () => {},
        logError: (context, err) => errors.push(`${context}: ${err.message}`),
    });
    await broken.runOnce();
    assert.deepEqual(errors, ['settings retry round: no cache']);
    await retrier.runOnce();
});
