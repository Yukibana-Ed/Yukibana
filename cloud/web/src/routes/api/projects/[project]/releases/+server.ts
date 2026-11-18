import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { uuidOf, type ProjectId, type ReleaseId } from '#lib/ids.ts';
import { answering, bearerOf, requireBearer, requireCi, requireClaims, withContext } from '#lib/server/context.ts';
import { isCiToken } from '#lib/server/oidc.ts';
import { releases } from '#lib/server/catalogue.ts';
import { publishRelease, type Publisher } from '#lib/server/releases.ts';
import { text, uuidIn } from '#lib/server/form.ts';

/** The project's releases, newest first. Staff only, by the table's
 *  policy; a student gets an empty list. */
export const GET: RequestHandler = async event => {
    const claims = requireClaims(event);
    const project = uuidOf<ProjectId>(event.params.project);
    if (project === null) error(404, 'No such project.');
    return json(await withContext(ctx => answering('api/releases', () => releases(ctx, claims, project))));
};

/** A release: multipart with `starter` and `teacher` (both .tar.gz), an
 *  optional `label` and `commit`, and the optional `release` id the
 *  publisher wrote into the starter (see `publishRelease`). Authenticated by a bearer, and only a
 *  bearer: a project token (`yk_…`, from CI), a GitHub Actions OIDC token
 *  (from `yukibana publish --ci` in a repository linked to the project), or
 *  a person's access token (from `yukibana publish` after `yukibana
 *  login`), who must be staff of the project's edition.
 *
 *  A bearer that is a JWT from any issuer but Supabase Auth (`isCiToken`)
 *  takes the CI branch, before
 *  the session's: it is verified here (`requireCi`), and refused as a 401
 *  "CI token refused: <why>" before the body is read. Without that branch
 *  it would reach `requireBearer`, and every CI token would be refused as a
 *  bad session.
 *
 *  A cookie session is deliberately not accepted here. It used to be, and
 *  it was a cross-site request forgery waiting to happen: this takes a
 *  multipart body, which is a thing any page on any site can make a browser
 *  POST, and cookies would have ridden along with it. A page on evil.com
 *  could have published a release to a project its visitor owns. A bearer
 *  header is never ambient, so a person's token is as safe here as a
 *  project's. The project page has no upload of its own any more (see
 *  docs/cloud/design.md): a release's id travels inside its starter, and only the
 *  CLI writes it there. */
export const POST: RequestHandler = async event => {
    const project = uuidOf<ProjectId>(event.params.project);
    if (project === null) error(404, 'No such project.');
    const bearer = bearerOf(event);
    const token = bearer?.match(/^yk_[0-9a-f]{64}$/i)?.[0];
    const by: Publisher =
        token !== undefined
            ? { kind: 'token', secret: token }
            : bearer !== null && isCiToken(bearer)
              ? { kind: 'ci', identity: await requireCi(event) }
              : { kind: 'user', claims: event.request.headers.has('authorization') ? requireBearer(event) : bearerMissing() };

    const form = await event.request.formData().catch(() => null);
    if (form === null) error(400, 'Send the two archives as multipart form data.');
    const release = uuidIn<ReleaseId>(form, 'release');
    const starter = form.get('starter');
    const teacher = form.get('teacher');
    if (!(starter instanceof File) || !(teacher instanceof File)) error(400, 'Both `starter` and `teacher` files are required.');
    // The archives are read whole; the cap in wrangler.jsonc keeps that sane.
    const starterBytes = new Uint8Array(await starter.arrayBuffer());
    const teacherBytes = new Uint8Array(await teacher.arrayBuffer());
    const published = await withContext(ctx => publishRelease(ctx, by, project, starterBytes, teacherBytes, text(form, 'label'), text(form, 'commit') || null, release));
    return json(published, { status: 201 });
};

function bearerMissing(): never {
    error(401, 'Send a project token, or your session, as a bearer. Make a token on the project page.');
}
