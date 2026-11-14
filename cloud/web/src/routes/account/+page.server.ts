import { fail, isHttpError } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { asUser, refusalOf } from '#lib/server/db.ts';
import { requireClaims, withContext } from '#lib/server/context.ts';
import { clearPicture, pictureOf, setPicture } from '#lib/server/pictures.ts';
import { pictureUrl } from '#lib/picture/url.ts';

/** The signed-in person's own account: their name and address as the profile has them, and their profile picture's
 *  path, or null when they have none. The login page for nobody. */
export const load: PageServerLoad = async event => {
    const claims = requireClaims(event);
    return withContext(ctx =>
        asUser(ctx.sql, claims, async tx => {
            const [u] = await tx<{ full_name: string | null; github_login: string | null }[]>`
        select full_name, github_login from app_user where user_id = ${claims.sub}`;
            const picture = await pictureOf(tx, claims.sub);
            return {
                email: claims.email,
                fullName: u?.full_name ?? null,
                githubLogin: u?.github_login ?? null,
                picture: picture === null ? null : pictureUrl(claims.sub, picture),
            };
        }),
    );
};

/** The account page's forms. */
export const actions: Actions = {
    /** Makes the file in the multipart field `picture` the caller's profile picture (`setPicture`): a square WebP the
     *  page's cropper made. Answers `{ ok: true }`; a 400 when no file was sent; or a `fail` with the status and sentence
     *  of a refusal (415 or 413 for bytes that are not such a picture, 403 from the database), or a fixed sentence for a
     *  failure of the server's. */
    picture: async event => {
        const claims = requireClaims(event);
        const file = (await event.request.formData()).get('picture');
        if (!(file instanceof File)) return fail(400, { error: 'No picture was sent.' });
        try {
            await withContext(async ctx => setPicture(ctx, claims, new Uint8Array(await file.arrayBuffer())));
        } catch (e) {
            return refused(e);
        }
        return { ok: true };
    },

    /** Removes the caller's profile picture, if any (`clearPicture`). Answers `{ ok: true }`, or a `fail` as `picture`
     *  does. */
    removePicture: async event => {
        const claims = requireClaims(event);
        try {
            await withContext(ctx => clearPicture(ctx, claims));
        } catch (e) {
            return refused(e);
        }
        return { ok: true };
    },
};

/** The `fail` for `e`, a failure of an action's work: an HTTP error that `setPicture` or `clearPicture` threw keeps its
 *  status and sentence, which were written for the person; anything else is `refusalOf`'s answer. */
function refused(e: unknown): ReturnType<typeof fail<{ error: string }>> {
    if (isHttpError(e)) return fail(e.status, { error: e.body.message });
    const { status, message } = refusalOf('account', e);
    return fail(status, { error: message });
}
