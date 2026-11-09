import { test } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Session } from '@yukibana/client';
import { defaultSessionPath, fileStore } from '../src/store.js';

const SESSION: Session = {
    url: 'https://cloud.yukibana.dev',
    supabaseUrl: 'https://auth.yukibana.dev',
    publishableKey: 'sb_publishable_x',
    accessToken: 'access',
    refreshToken: 'refresh',
    expiresAt: 1_800_000_000,
    email: null,
};

test('a login survives the terminal closing, in a file only its owner can read', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'yukibana-store-')), 'nested', 'session.json');
    await fileStore(path).save(SESSION);
    assert.deepEqual(await fileStore(path).load(), SESSION);
    assert.equal((await stat(path)).mode & 0o777, 0o600);
    await fileStore(path).clear();
    assert.equal(await fileStore(path).load(), null, 'logged out is no file');
});

test('a damaged session file means logging in again, not a crash', async () => {
    const path = join(await mkdtemp(join(tmpdir(), 'yukibana-store-')), 'session.json');
    await writeFile(path, JSON.stringify({ ...SESSION, refreshToken: 7 }));
    assert.equal(await fileStore(path).load(), null);
});

test('the session file is where YUKIBANA_CONFIG_DIR, then XDG_CONFIG_HOME, says', () => {
    assert.equal(defaultSessionPath({ YUKIBANA_CONFIG_DIR: '/a', XDG_CONFIG_HOME: '/b' }), '/a/session.json');
    assert.equal(defaultSessionPath({ XDG_CONFIG_HOME: '/b' }), '/b/yukibana/session.json');
});
