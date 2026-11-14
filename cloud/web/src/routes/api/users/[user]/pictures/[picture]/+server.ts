import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { uuidOf, type PictureId, type UserId } from '#lib/ids.ts';
import { requireClaims, withContext } from '#lib/server/context.ts';
import { servePicture } from '#lib/server/pictures.ts';

/** A person's profile picture, as WebP, for an `<img>` on this site's pages: a 404 unless it is their current picture
 *  and the caller may see their profile (`servePicture`). Only reads. */
export const GET: RequestHandler = async event => {
    const claims = requireClaims(event);
    const user = uuidOf<UserId>(event.params.user);
    const picture = uuidOf<PictureId>(event.params.picture);
    if (user === null || picture === null) error(404, 'No such picture.');
    return withContext(ctx => servePicture(ctx, claims, user, picture));
};
