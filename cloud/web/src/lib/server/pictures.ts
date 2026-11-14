/** Profile pictures: storing the one a browser made, removing it, and serving it back to the people who may see it.
 *
 *  The browser crops and encodes (`#lib/picture/`); this checks the bytes are what it was meant to make, stores them,
 *  and asks the database, as the person, whose picture is which. Who may see a picture is `profile_picture_read`
 *  (20261114090000_profile_pictures.sql), never decided here.
 */

import { error, isHttpError } from '@sveltejs/kit';
import type { Claims } from '#lib/claims.ts';
import { pictureKey, trustId, type ObjectKey, type PictureId, type UserId } from '#lib/ids.ts';
import { pictureProblem } from '#lib/picture/webp.ts';
import { report } from '#lib/report.ts';
import { asUser, Misconfigured, statusOf, type Tx } from './db';
import type { Context } from './context';

/** Makes `bytes` the caller's profile picture and returns its id, or throws the HTTP error that says why not: 415 for
 *  bytes `pictureProblem` refuses (413 for too many), 403 when the database refuses the caller, 500 for a failure of
 *  the database or the bucket, reported and answered with a fixed sentence (or the operator's, for `Misconfigured`).
 *
 *  The object before the row, so that every row has an object; an object whose row was refused is deleted. The
 *  picture it replaced is deleted after the row has moved on, and a failure to delete it is reported, not thrown: the
 *  new picture is already the person's, and the old one is unreachable, since the read route asks the table. */
export async function setPicture(ctx: Context, claims: Claims, bytes: Uint8Array): Promise<PictureId> {
    const problem = pictureProblem(bytes);
    if (problem !== null) error(problem.includes('larger than') ? 413 : 415, problem);
    const picture = crypto.randomUUID() as PictureId; // a fresh v4 per upload: see `PictureId`
    const key = pictureKey(claims.sub, picture);
    try {
        await ctx.bucket.put(key, bytes, 'image/webp');
    } catch (e) {
        await forget(ctx, key);
        failed(e);
    }
    let replaced: string | null;
    try {
        replaced = await asUser(
            ctx.sql,
            claims,
            async tx => (await tx<{ replaced: string | null }[]>`select app.set_profile_picture(${picture}) as replaced`)[0]?.replaced ?? null,
        );
    } catch (e) {
        await forget(ctx, key);
        if (statusOf(e).status === 403) error(403, statusOf(e).message);
        failed(e);
    }
    if (replaced !== null) await forget(ctx, pictureKey(claims.sub, trustId<PictureId>(replaced)));
    return picture;
}

/** Removes the caller's profile picture, if they have one, and deletes its object (reporting, not throwing, when the
 *  bucket will not). Throws as `setPicture` does for a failure of the database. */
export async function clearPicture(ctx: Context, claims: Claims): Promise<void> {
    let removed: string | null;
    try {
        removed = await asUser(ctx.sql, claims, async tx => (await tx<{ removed: string | null }[]>`select app.clear_profile_picture() as removed`)[0]?.removed ?? null);
    } catch (e) {
        if (statusOf(e).status === 403) error(403, statusOf(e).message);
        failed(e);
    }
    if (removed !== null) await forget(ctx, pictureKey(claims.sub, trustId<PictureId>(removed)));
}

/** Returns the id of `user`'s current picture, or null when they have none or the caller may not see it; inside the
 *  caller's transaction `tx`, so that a page reads it with the rest of what it shows.
 *
 *  A picture is never worth a page: a failure to read it is reported and answered with null, in a savepoint so that
 *  the rest of `tx` goes on. Every page asks (the header shows the picture), and a PR preview runs this code against a
 *  database that may not have the table yet. */
export async function pictureOf(tx: Tx, user: UserId): Promise<PictureId | null> {
    try {
        const [row] = await tx.savepoint(sp => sp<{ picture_id: string }[]>`select picture_id from profile_picture where user_id = ${user}`);
        return row === undefined ? null : trustId<PictureId>(row.picture_id);
    } catch (e) {
        report('pictures', `reading the picture of ${user}: ${e instanceof Error ? e.message : String(e)}`);
        return null;
    }
}

/** Answers a GET for `user`'s picture `picture` with its bytes, streamed from the bucket, or a 404 when that is not
 *  their current picture or the caller may not see it (the two are not told apart). The answer may be cached by the
 *  browser for a year and by nothing else: the URL names one set of bytes forever, and only people the database lets
 *  see it should hold a copy. */
export async function servePicture(ctx: Context, claims: Claims, user: UserId, picture: PictureId): Promise<Response> {
    const seen = await asUser(ctx.sql, claims, tx => tx`select 1 from profile_picture where user_id = ${user} and picture_id = ${picture}`);
    if (seen.length === 0) error(404, 'No such picture.');
    const got = await ctx.bucket.open(pictureKey(user, picture));
    if (got === null) {
        report('pictures', `missing object ${pictureKey(user, picture)}`);
        error(404, 'No such picture.');
    }
    return new Response(got.body, {
        headers: {
            'content-type': 'image/webp',
            'content-length': String(got.size),
            'cache-control': 'private, max-age=31536000, immutable',
            // Shown as an image and nothing else, even if a browser were asked to open it as a document.
            'x-content-type-options': 'nosniff',
            'content-security-policy': "default-src 'none'; sandbox",
        },
    });
}

/** Deletes `key`, reporting rather than throwing when the bucket will not. */
async function forget(ctx: Context, key: ObjectKey): Promise<void> {
    try {
        await ctx.bucket.delete(key);
    } catch (e) {
        report('pictures', `orphaned ${key}: ${e instanceof Error ? e.message : String(e)}`);
    }
}

/** Answers a failure that is not a refusal: a SvelteKit error passes through, `Misconfigured` is a 500 that says so,
 *  and anything else is reported and answered with a fixed sentence, since its message may quote a query. */
function failed(e: unknown): never {
    if (isHttpError(e)) throw e;
    if (e instanceof Misconfigured) error(500, e.message);
    report('pictures', e instanceof Error ? e.message : String(e));
    error(500, 'The picture could not be saved.');
}
