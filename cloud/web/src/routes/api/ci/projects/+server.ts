import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { answering, requireCi, withContext } from '#lib/server/context.ts';
import { ciLinks, ciProjectsOf } from '#lib/server/ci.ts';

/** The projects the CI job whose GitHub Actions OIDC token is the bearer may
 *  publish to (`CiProjectsJson`), for `yukibana publish --ci` to fan out
 *  over and to print. Only such a token is accepted, verified here
 *  (`requireCi`): anything else, a person's session included, is a 401. A
 *  project the job would be refused is listed with the reason, so the job
 *  log can say why it was skipped; a repository that moved to another owner
 *  is told that it moved and nothing else. A read, as the publisher, which
 *  reads no table. */
export const GET: RequestHandler = async event => {
    const identity = await requireCi(event);
    return json(await withContext(ctx => answering('api/ci/projects', async () => ciProjectsOf(identity, await ciLinks(ctx, identity)))));
};
