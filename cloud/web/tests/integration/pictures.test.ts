import { test, expect, afterAll } from 'vitest';
import { isHttpError } from '@sveltejs/kit';
import { asUser, connect } from '../../src/lib/server/db.js';
import { s3Bucket } from '../../src/lib/server/storage.js';
import { clearPicture, pictureOf, servePicture, setPicture } from '../../src/lib/server/pictures.js';
import { pictureKey, type PictureId, type UserId } from '../../src/lib/ids.js';
import type { Context } from '../../src/lib/server/context.js';
import { ALICE, BOB, TEACHER, claimsOf, config } from './env.js';

const sql = connect(config.databaseUrl);
const bucket = s3Bucket(config.s3);
const ctx: Context = { config, sql, bucket };
afterAll(async () => {
    await clearPicture(ctx, claimsOf(ALICE));
    await sql.end({ timeout: 5 });
});

// A 256-pixel square WebP from libwebp, the kind a browser's canvas makes.
const PICTURE = new Uint8Array(
    Buffer.from(
        'UklGRrgAAABXRUJQVlA4IKwAAADwEACdASoAAQABPm02mUmkIyKhICgAgA2JaW7hdrEbQArN2vFych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2TkPfbJyHvtk5D32ych77ZOQ99snIe+2Tj+AA/v9YeHf///YO//84D//nAf0UAAAAAAAAAAAA',
        'base64',
    ),
);

const statusOf = async (run: () => Promise<unknown>): Promise<number> => {
    try {
        await run();
        return 200;
    } catch (e) {
        if (isHttpError(e)) return e.status;
        throw e;
    }
};

const current = (addr: string, of: UserId): Promise<PictureId | null> => asUser(sql, claimsOf(addr), tx => pictureOf(tx, of));

test('a student sets a picture, a classmate and their teacher see it, and a new one replaces the old object', async () => {
    const alice = claimsOf(ALICE);
    const first = await setPicture(ctx, alice, PICTURE);
    expect(await bucket.get(pictureKey(alice.sub, first))).toEqual(PICTURE);
    expect(await current(BOB, alice.sub)).toBe(first);
    expect(await current(TEACHER, alice.sub)).toBe(first);

    const served = await servePicture(ctx, claimsOf(BOB), alice.sub, first);
    expect(served.headers.get('content-type')).toBe('image/webp');
    expect(served.headers.get('cache-control')).toContain('private');
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(PICTURE);

    const second = await setPicture(ctx, alice, PICTURE);
    expect(second).not.toBe(first);
    expect(await bucket.head(pictureKey(alice.sub, first)), 'the replaced object is deleted').toBeNull();
    expect(await statusOf(() => servePicture(ctx, claimsOf(BOB), alice.sub, first)), 'and its address no longer answers').toBe(404);
});

test('bytes that are not a picture the page made are refused and nothing is stored', async () => {
    const alice = claimsOf(ALICE);
    const before = await current(ALICE, alice.sub);
    const png = new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
    expect(await statusOf(() => setPicture(ctx, alice, png))).toBe(415);
    expect(await statusOf(() => setPicture(ctx, alice, new Uint8Array(200 * 1024)))).toBe(413);
    expect(await current(ALICE, alice.sub)).toBe(before);
});

test('a picture is not served under another person, or under an id that was never theirs', async () => {
    const alice = claimsOf(ALICE);
    const picture = await setPicture(ctx, alice, PICTURE);
    expect(await statusOf(() => servePicture(ctx, claimsOf(BOB), claimsOf(BOB).sub, picture))).toBe(404);
    expect(await statusOf(() => servePicture(ctx, claimsOf(BOB), alice.sub, crypto.randomUUID() as PictureId))).toBe(404);
});

test('removing a picture deletes its object, and removing none is fine', async () => {
    const alice = claimsOf(ALICE);
    const picture = await setPicture(ctx, alice, PICTURE);
    await clearPicture(ctx, alice);
    expect(await current(ALICE, alice.sub)).toBeNull();
    expect(await bucket.head(pictureKey(alice.sub, picture))).toBeNull();
    await clearPicture(ctx, alice);
});
