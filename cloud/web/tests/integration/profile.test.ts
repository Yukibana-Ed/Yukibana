import { test, expect, afterAll } from 'vitest';
import { isHttpError } from '@sveltejs/kit';
import { asUser, connect } from '../../src/lib/server/db.js';
import { s3Bucket } from '../../src/lib/server/storage.js';
import { editions, me, members } from '../../src/lib/server/catalogue.js';
import { clearPicture, servePicture, setPicture } from '../../src/lib/server/pictures.js';
import { ownProfile, saveProfile } from '../../src/lib/server/profile.js';
import { trustId, type EditionId } from '../../src/lib/ids.js';
import type { Context } from '../../src/lib/server/context.js';
import { ALICE, BOB, TEACHER, claimsOf, config } from './env.js';

const sql = connect(config.databaseUrl);
const ctx: Context = { config, sql, bucket: s3Bucket(config.s3) };
afterAll(async () => {
    await saveProfile(ctx, claimsOf(ALICE), 'Alice Student', 'courses', 'courses');
    await clearPicture(ctx, claimsOf(ALICE));
    await sql.end({ timeout: 5 });
});

const PICTURE = new Uint8Array(Buffer.from('UklGRiQAAABXRUJQVlA4TBgAAAAv/8A/AAdQxlJUq/8BAEX6/58i+p/6338=', 'base64'));

async function edition(): Promise<EditionId> {
    const [e] = await editions(ctx, claimsOf(ALICE));
    if (e === undefined) throw new Error('Alice is enrolled nowhere');
    return trustId<EditionId>(e.editionId);
}

/** The name `viewer` sees for Alice on the edition's roster. */
async function aliceAsSeenBy(viewer: string): Promise<string | null | undefined> {
    return (await members(ctx, claimsOf(viewer), await edition())).find(m => m.email === ALICE)?.fullName;
}

test('a student who keeps their name to themselves is listed without it, to classmates and teachers alike', async () => {
    await saveProfile(ctx, claimsOf(ALICE), 'Alice Liddell', 'private', 'courses');
    expect((await me(ctx, claimsOf(ALICE))).fullName).toBe('Alice Liddell');
    expect(await aliceAsSeenBy(TEACHER)).toBeNull();
    await saveProfile(ctx, claimsOf(ALICE), 'Alice Liddell', 'courses', 'courses');
    expect(await aliceAsSeenBy(TEACHER)).toBe('Alice Liddell');
    expect(await asUser(sql, claimsOf(ALICE), tx => ownProfile(tx, claimsOf(ALICE)))).toEqual({
        fullName: 'Alice Liddell',
        githubLogin: 'alice',
        nameAudience: 'courses',
        pictureAudience: 'courses',
    });
});

test('a picture kept private is not served to a classmate, and is again once shared with the course', async () => {
    const picture = await setPicture(ctx, claimsOf(ALICE), PICTURE);
    await saveProfile(ctx, claimsOf(ALICE), 'Alice Liddell', 'courses', 'private');
    const bob = async (): Promise<number> => {
        try {
            return (await servePicture(ctx, claimsOf(BOB), claimsOf(ALICE).sub, picture)).status;
        } catch (e) {
            if (isHttpError(e)) return e.status;
            throw e;
        }
    };
    expect(await bob()).toBe(404);
    expect((await servePicture(ctx, claimsOf(ALICE), claimsOf(ALICE).sub, picture)).status).toBe(200);
    await saveProfile(ctx, claimsOf(ALICE), 'Alice Liddell', 'courses', 'courses');
    expect(await bob()).toBe(200);
});

test('a name longer than a hundred characters is refused with a reason', async () => {
    await expect(saveProfile(ctx, claimsOf(ALICE), 'x'.repeat(101), 'courses', 'courses')).rejects.toMatchObject({ code: '23514' });
});
