import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { uuidOf, type SubmissionId } from '#lib/ids.ts';
import { fromBucket, requireClaims, toBucket, withContext } from '#lib/server/context.ts';
import { submissionObject, submissionUrl } from '#lib/server/submissions.ts';

/** A submission's body, for its author or the edition's staff: a redirect
 *  to a URL on the bucket that works for a minute, or with `?inline` the
 *  bytes themselves through the Worker (`fromBucket`), for the staff page
 *  that assembles a submission in the browser. */
export const GET: RequestHandler = async event => {
    const claims = requireClaims(event);
    const submission = uuidOf<SubmissionId>(event.params.submission);
    if (submission === null) error(404, 'No such submission.');
    if (event.url.searchParams.has('inline')) return withContext(async ctx => fromBucket(ctx, await submissionObject(ctx, claims, submission)));
    return withContext(async ctx => toBucket(ctx, await submissionUrl(ctx, claims, submission)));
};
