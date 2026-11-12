import { test } from 'vitest';
import assert from 'node:assert/strict';
import { INVITE_PATH, inviteLink, inviteSecretOf } from '../src/lib/invite.js';

const SECRET = `yk_invite_${'0123456789abcdef'.repeat(4)}`;

test('an invite link is the site, the invite path, and the whole secret', () => {
    assert.equal(inviteLink('https://cloud.yukibana.dev', SECRET), `https://cloud.yukibana.dev${INVITE_PATH}${SECRET}`);
    assert.throws(() => inviteLink('https://cloud.yukibana.dev', 'yk_invite_short'), TypeError);
});

test('only a whole secret as the database makes them is taken from a link', () => {
    assert.equal(inviteSecretOf(SECRET), SECRET);
    assert.equal(inviteSecretOf(SECRET.slice(0, -1)), null, 'a link cut short in a mail');
    assert.equal(inviteSecretOf(`${SECRET}0`), null);
    assert.equal(inviteSecretOf(SECRET.toUpperCase()), null);
    assert.equal(inviteSecretOf(`yk_${'0'.repeat(64)}`), null, 'a project token is not an invite');
    assert.equal(inviteSecretOf(`${SECRET}/../admin`), null);
    assert.equal(inviteSecretOf(''), null);
    assert.equal(inviteSecretOf(undefined), null);
    assert.equal(inviteSecretOf(null), null);
});
