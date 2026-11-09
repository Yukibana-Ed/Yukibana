import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { uuidOf, type ReleaseId } from '#lib/ids.ts';
import { fromBucket, requireClaims, toBucket, withContext } from '#lib/server/context.ts';
import { releaseObject, releaseUrl } from '#lib/server/releases.ts';

/** One archive of a release, for staff: a redirect to a URL on the bucket
 *  that works for a minute, or with `?inline` the bytes themselves through
 *  the Worker (`fromBucket`), for the staff page that assembles a
 *  submission in the browser. `archive` is `starter` or `teacher`. */
export const GET: RequestHandler = async event => {
    const claims = requireClaims(event);
    const release = uuidOf<ReleaseId>(event.params.release);
    const archive = event.params.archive;
    if (release === null || (archive !== 'starter' && archive !== 'teacher')) error(404, 'No such archive.');
    if (event.url.searchParams.has('inline')) return withContext(async ctx => fromBucket(ctx, await releaseObject(ctx, claims, release, archive)));
    return withContext(async ctx => toBucket(ctx, await releaseUrl(ctx, claims, release, archive)));
};
