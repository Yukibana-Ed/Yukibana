import { test, expect } from 'vitest';
import { cookieKey, openState, openToken, sealState, sealToken, GITHUB_TOKEN_SECONDS, GITHUB_STATE_SECONDS } from '../src/lib/server/github-cookie';
import type { EditionId, ProjectId } from '../src/lib/ids';

const ME = '6f1c1c6e-0000-4000-8000-000000000001';
const SOMEBODY = '6f1c1c6e-0000-4000-8000-000000000002';
const now = new Date('2026-11-18T12:00:00Z');
const later = (seconds: number) => new Date(now.getTime() + seconds * 1000);
const flight = {
    state: 'c3RhdGUtb2YtdGhlLWJyb3dzZXI',
    sub: ME,
    edition: '11111111-1111-4111-8111-111111111111' as EditionId,
    project: '22222222-2222-4222-8222-222222222222' as ProjectId,
    relink: false,
};

test('a GitHub token sealed for the person signed in opens for them until it expires', async () => {
    const key = await cookieKey('client-secret');
    const sealed = await sealToken('ghu_secret', ME, key, now);
    expect(sealed).not.toContain('ghu_secret');
    expect(await openToken(sealed, ME, key, now)).toBe('ghu_secret');
    expect(await openToken(sealed, ME, key, later(GITHUB_TOKEN_SECONDS - 1))).toBe('ghu_secret');
    expect(await openToken(sealed, ME, key, later(GITHUB_TOKEN_SECONDS))).toBeNull();
});

test('a GitHub cookie sealed for another person is not used', async () => {
    const key = await cookieKey('client-secret');
    expect(await openToken(await sealToken('ghu_theirs', SOMEBODY, key, now), ME, key, now)).toBeNull();
});

test('a tampered GitHub cookie, or one sealed under another client secret, opens to nothing', async () => {
    const key = await cookieKey('client-secret');
    const sealed = await sealToken('ghu_secret', ME, key, now);
    const flipped = `${sealed.slice(0, 20)}${sealed[20] === 'A' ? 'B' : 'A'}${sealed.slice(21)}`;
    expect(await openToken(flipped, ME, key, now)).toBeNull();
    expect(await openToken(sealed.slice(0, -2), ME, key, now)).toBeNull();
    expect(await openToken(sealed, ME, await cookieKey('rotated-secret'), now)).toBeNull();
    for (const junk of ['', 'not sealed', 'AAAA', '!!!!'] as const) expect(await openToken(junk, ME, key, now), junk).toBeNull();
    expect(await openToken(undefined, ME, key, now)).toBeNull();
});

test('a state cookie is never read as a token cookie, nor the other way round', async () => {
    const key = await cookieKey('client-secret');
    expect(await openToken(await sealState(flight, key, now), ME, key, now)).toBeNull();
    expect(await openState(await sealToken('ghu_secret', ME, key, now), key, now)).toBeNull();
});

test('a connection in flight opens with its state, person, edition and project for ten minutes', async () => {
    const key = await cookieKey('client-secret');
    const sealed = await sealState(flight, key, now);
    expect(await openState(sealed, key, later(GITHUB_STATE_SECONDS - 1))).toEqual(flight);
    expect(await openState(sealed, key, later(GITHUB_STATE_SECONDS))).toBeNull();
    expect(await openState(sealed, await cookieKey('another-secret'), now)).toBeNull();
});
