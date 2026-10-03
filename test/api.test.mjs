import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readApiResult, errorReply, ApiError, GENERIC_ERROR_REPLY } from '../lib/api.mjs';

function res(status, body) {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return { status, ok: status >= 200 && status < 300, text: async () => text };
}

const err = (code, message) => ({ ok: false, error: { code, message } });

test('2xx ok body resolves to its data', async () => {
    assert.deepEqual(await readApiResult(res(200, { ok: true, data: { url: 'u' } })), { ok: true, data: { url: 'u' } });
});

test('429 cooldown message is shown to the user', async () => {
    const r = await readApiResult(res(429, err('RATE_LIMITED', 'Cooldown active. Try again in 7s')));
    assert.equal(r.ok, false);
    assert.ok(r.error instanceof ApiError);
    assert.equal(r.error.status, 429);
    assert.equal(r.error.code, 'RATE_LIMITED');
    assert.equal(errorReply(r.error), 'Cooldown active. Try again in 7s');
    assert.match(r.error.message, /HTTP 429 RATE_LIMITED Cooldown active/);
});

test('400 and 401 messages are shown', async () => {
    const bad = await readApiResult(res(400, err('BAD_REQUEST', 'Message must be 500 characters or less')));
    assert.equal(errorReply(bad.error), 'Message must be 500 characters or less');
    const unauth = await readApiResult(res(401, err('UNAUTHORIZED', 'Unknown Discord user for this server')));
    assert.equal(errorReply(unauth.error), 'Unknown Discord user for this server');
});

test('5xx stays generic even with a JSON error body', async () => {
    const r = await readApiResult(res(500, err('INTERNAL', 'D1_ERROR: something internal')));
    assert.equal(r.ok, false);
    assert.equal(r.error.userMessage, null);
    assert.equal(errorReply(r.error), GENERIC_ERROR_REPLY);
    assert.match(r.error.message, /D1_ERROR/);
});

test('non-JSON 4xx body stays generic', async () => {
    const r = await readApiResult(res(404, '404 Not Found'));
    assert.equal(errorReply(r.error), GENERIC_ERROR_REPLY);
    assert.match(r.error.message, /HTTP 404 non-JSON body: 404 Not Found/);
});

test('4xx JSON without an error message stays generic', async () => {
    for (const body of [{ ok: false }, { ok: false, error: { code: 'X', message: '  ' } }, { something: 1 }, null]) {
        const r = await readApiResult(res(400, body === null ? '' : body));
        assert.equal(r.ok, false);
        assert.equal(errorReply(r.error), GENERIC_ERROR_REPLY);
    }
});

test('2xx with ok=false shows the message; 2xx with a broken body is generic', async () => {
    const a = await readApiResult(res(200, err('X', 'nope')));
    assert.equal(errorReply(a.error), 'nope');
    const b = await readApiResult(res(200, 'not json'));
    assert.equal(b.ok, false);
    assert.equal(errorReply(b.error), GENERIC_ERROR_REPLY);
});

test('very long messages are shortened', async () => {
    const r = await readApiResult(res(400, err('BAD_REQUEST', 'x'.repeat(1000))));
    assert.equal(errorReply(r.error).length, 300);
});

test('errorReply falls back for network errors and timeouts', () => {
    assert.equal(errorReply(new TypeError('fetch failed')), GENERIC_ERROR_REPLY);
    assert.equal(errorReply(new DOMException('timed out', 'TimeoutError')), GENERIC_ERROR_REPLY);
    assert.equal(errorReply(new Error('x'), 'Custom fallback.'), 'Custom fallback.');
    assert.equal(errorReply(undefined), GENERIC_ERROR_REPLY);
});

test('a failing body read is treated as a non-JSON body', async () => {
    const r = await readApiResult({ status: 429, text: async () => { throw new Error('aborted'); } });
    assert.equal(r.ok, false);
    assert.equal(errorReply(r.error), GENERIC_ERROR_REPLY);
});
