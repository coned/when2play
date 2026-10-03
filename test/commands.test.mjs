import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    truncate,
    memberDisplayName,
    avatarUrlFor,
    buildSyncBody,
    findSyncedUser,
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
