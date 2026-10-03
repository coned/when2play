import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    truncate,
    memberDisplayName,
    avatarUrlFor,
    buildSyncBody,
    findSyncedUser,
    buildTreeSummary,
} from '../lib/commands.mjs';

const user = (over = {}) => ({ id: '111111111111111111', username: 'dave_99', displayName: 'Dave Global', ...over });

test('memberDisplayName prefers the GuildMember displayName', () => {
    assert.equal(memberDisplayName({ displayName: 'Server Dave' }, user()), 'Server Dave');
});

test('memberDisplayName reads nick from a raw API member, falls back when nick is null', () => {
    assert.equal(memberDisplayName({ nick: 'Raw Nick', user: {} }, user()), 'Raw Nick');
    assert.equal(memberDisplayName({ nick: null, user: {} }, user()), 'Dave Global');
});

test('memberDisplayName without a member uses displayName, then username', () => {
    assert.equal(memberDisplayName(null, user()), 'Dave Global');
    assert.equal(memberDisplayName(undefined, user({ displayName: undefined })), 'dave_99');
    assert.equal(memberDisplayName(null, user({ displayName: '' })), 'dave_99');
});

test('names longer than 50 characters are cut to 50', () => {
    const long = 'n'.repeat(80);
    assert.equal(memberDisplayName({ displayName: long }, user()).length, 50);
    assert.equal(memberDisplayName({ nick: long }, user()).length, 50);
});

test('truncate never splits a surrogate pair', () => {
    const text = `${'a'.repeat(49)}😀b`;
    assert.equal(truncate(text, 50), 'a'.repeat(49));
    assert.equal(truncate('short', 50), 'short');
});

test('avatarUrlFor returns the URL, or null when missing, failing or too long', () => {
    assert.equal(avatarUrlFor({ displayAvatarURL: () => 'https://cdn.example/a.png' }), 'https://cdn.example/a.png');
    assert.equal(avatarUrlFor({}), null);
    assert.equal(avatarUrlFor({ displayAvatarURL: () => { throw new Error('x'); } }), null);
    assert.equal(avatarUrlFor({ displayAvatarURL: () => `https://x/${'a'.repeat(600)}` }), null);
});

test('buildSyncBody keeps order, drops duplicate ids and cuts long values', () => {
    const body = buildSyncBody([
        { discordId: '1', name: 'Caller', avatarUrl: 'https://a' },
        { discordId: '2', name: 'x'.repeat(70) },
        { discordId: '1', name: 'Caller again' },
    ], 'g'.repeat(150));
    assert.deepEqual(body.users, [
        { discord_id: '1', discord_username: 'Caller', avatar_url: 'https://a' },
        { discord_id: '2', discord_username: 'x'.repeat(50), avatar_url: null },
    ]);
    assert.equal(body.guild_name.length, 100);
});

test('buildSyncBody omits a missing guild name', () => {
    assert.equal('guild_name' in buildSyncBody([{ discordId: '1', name: 'a' }], undefined), false);
    assert.equal('guild_name' in buildSyncBody([{ discordId: '1', name: 'a' }], ''), false);
});

test('findSyncedUser matches by discord_id', () => {
    const data = { users: [
        { id: 'u1', discord_id: '1', discord_username: 'a', display_name: null },
        { id: 'u2', discord_id: '2', discord_username: 'b', display_name: 'B' },
    ] };
    assert.equal(findSyncedUser(data, '2').id, 'u2');
    assert.equal(findSyncedUser(data, '3'), null);
    assert.equal(findSyncedUser(null, '1'), null);
    assert.equal(findSyncedUser({ users: [{ discord_id: '1' }] }, '1'), null);
});

// --- /post gametree summary ---

const act = (action_type, actor_username, message = null) => ({ action_type, actor_username, message });

test('tree summary for a short day, with every icon including share_ranking', () => {
    const text = buildTreeSummary({
        dayKey: '2026-03-10',
        actorName: 'Dave',
        actions: [
            act('call', 'alice', 'tonight?'),
            act('in', 'bob'),
            act('ping', 'Anonymous'),
            act('share_ranking', 'carol'),
            act('mystery', 'eve'),
        ],
    });
    assert.equal(text,
        '**Gaming Tree** -- 2026-03-10\n'
        + '📢 **alice**: call -- tonight?\n'
        + '✅ **bob**: in\n'
        + '👋 **Anonymous**: ping\n'
        + '🏆 **carol**: share_ranking\n'
        + '• **eve**: mystery\n'
        + '_On behalf of Dave_');
});

test('tree summary for an empty day', () => {
    assert.equal(buildTreeSummary({ dayKey: '2026-03-10', actions: [], actorName: 'Dave' }),
        '**Gaming Tree** -- 2026-03-10\nNo actions yet.\n_On behalf of Dave_');
    assert.equal(buildTreeSummary({ dayKey: '2026-03-10', actions: undefined, actorName: 'Dave' }),
        '**Gaming Tree** -- 2026-03-10\nNo actions yet.\n_On behalf of Dave_');
});

test('tree summary for a long day keeps the newest actions within 2000 characters', () => {
    const actions = Array.from({ length: 60 }, (_, i) => act('in', `user${i}`, `message number ${i} ${'x'.repeat(60)}`));
    const text = buildTreeSummary({ dayKey: '2026-03-10', actions, actorName: 'Dave' });
    assert.ok(text.length <= 2000, `length ${text.length}`);
    assert.ok(text.length > 1800, 'uses most of the room');
    const lines = text.split('\n');
    assert.equal(lines[0], '**Gaming Tree** -- 2026-03-10');
    const shown = lines.filter(l => l.startsWith('✅')).length;
    assert.match(lines[1], new RegExp(`^_\\.\\.\\. ${60 - shown} earlier actions not shown_$`));
    assert.ok(lines[2].startsWith('✅ **user' + (60 - shown) + '**'));
    assert.ok(lines.at(-2).startsWith('✅ **user59**'));
    assert.equal(lines.at(-1), '_On behalf of Dave_');
});

test('tree summary stays within the limit even with a single huge line', () => {
    const text = buildTreeSummary({
        dayKey: '2026-03-10',
        actions: [act('call', 'a'), act('out', 'b', 'y'.repeat(5000))],
        actorName: 'Dave',
    });
    assert.ok(text.length <= 2000);
    assert.match(text, /_\.\.\. 1 earlier action not shown_/);
    assert.ok(text.endsWith('_On behalf of Dave_'));
});
