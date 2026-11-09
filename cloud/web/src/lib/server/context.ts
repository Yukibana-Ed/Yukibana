/** What a route needs to do anything: the configuration, a database client
 *  for this request, the bucket, and the person asking.
 *
 *  `withContext` opens the client, runs the route, and closes the client
 *  after the response, so a route cannot forget to. `requireClaims` is the
 *  one place "you must be logged in" is decided: a page is sent to log in,
 *  an API call gets a 401.
 */

import { error, isHttpError, redirect, type RequestEvent } from '@sveltejs/kit';
import type { Claims } from '#lib/claims.ts';
import type { ObjectKey } from '#lib/ids.ts';
import type { Config } from './env';
import { afterResponse, workerConfig } from './worker.ts';
import { connect, Misconfigured, statusOf, type Sql } from './db';
import { report } from '#lib/report.ts';
import { s3Bucket, type Bucket } from './storage';

/** What a route's server code works with, for the length of one request. */
export interface Context {
    /** The Worker's configuration, read from its env. */
    readonly config: Config;
    /** This request's client of `config.databaseUrl`, which connects as `yukibana_app`, so a query outside `asUser`
     *  or `asPublisher` is refused. Closed after the response: nothing may keep it past `withContext`'s `run`. */
    readonly sql: Sql;
    /** The bucket the archives are in. */
    readonly bucket: Bucket;
}

/** Runs `run` with a context made for this request, returns what it returns, and closes the database client after the
 *  response is sent, whether `run` succeeded or threw.
 *
 *  - Requires: the Worker's env is a complete configuration; throws the error `configOf` gives, naming the first
 *    missing value, before anything connects. Runs only in the Worker, whose env (`cloudflare:workers`) it reads. */
export async function withContext<T>(run: (ctx: Context) => Promise<T>): Promise<T> {
    const config = workerConfig();
    const sql = connect(config.databaseUrl);
    const bucket = s3Bucket(config.s3);
    try {
        return await run({ config, sql, bucket });
    } finally {
        afterResponse(sql.end({ timeout: 5 }));
    }
}

/** The caller, or the way out. */
export function requireClaims(event: RequestEvent): Claims {
    const claims = event.locals.claims;
    if (claims !== null) return claims;
    if (event.url.pathname.startsWith('/api/')) error(401, 'Log in first.');
    redirect(303, `/auth/login?next=${encodeURIComponent(event.url.pathname + event.url.search)}`);
}

/** The caller of an API write, who must have sent their session as a
 *  bearer token, not as a cookie.
 *
 *  A cookie rides along with any request a browser makes, including one a
 *  page on another site makes it send; a bearer header is only there when
 *  the caller put it there. The JSON writes (enrolling, publishing as a
 *  person) are for the CLI and the IDE, which always send a bearer, so
 *  refusing cookies costs nothing and closes cross-site forgery for good,
 *  the way the release endpoint learned to (see its comment). `claimsFor`
 *  verifies a bearer whenever one is present and never falls back to the
 *  cookie, so claims plus a header means the claims are the header's. */
export function requireBearer(event: RequestEvent): Claims {
    const bearer = /^Bearer\s+\S+$/i.test(event.request.headers.get('authorization') ?? '');
    if (!bearer) error(401, 'Send your session as an Authorization: Bearer header.');
    return requireClaims(event);
}

/** Runs an API call's database work and answers a refusal with the
 *  database's own sentence and the status `statusOf` gives it. An
 *  unexpected failure is reported and answered without its message, which
 *  may quote the query. */
export async function answering<T>(where: string, run: () => Promise<T>): Promise<T> {
    try {
        return await run();
    } catch (e) {
        if (isHttpError(e)) throw e;
        if (e instanceof Misconfigured) error(500, e.message);
        const { status, message, code } = statusOf(e);
        if (status !== 500) error(status, message);
        report(where, message);
        error(500, `The request failed on the server${code === '' ? '' : ` (SQLSTATE ${code})`}; the Worker log says why.`);
    }
}

/** An object in the bucket that a download hands out, and the name the
 *  browser saves it as. */
export interface BucketObject {
    readonly key: ObjectKey;
    /** A file name, without separators or quotes. */
    readonly filename: string;
}

/** `o`'s bytes as the response, streamed through the Worker rather than
 *  redirected to the bucket: for a script on this site's own pages, which
 *  cannot read a cross-origin redirect's answer from a bucket without CORS.
 *  The body is piped, never read, so it costs the Worker next to no CPU
 *  however large it is. An object the database names and the bucket does
 *  not have is the server's failure: reported, and a 500. */
export async function fromBucket(ctx: Context, o: BucketObject): Promise<Response> {
    const got = await ctx.bucket.open(o.key);
    if (got === null) {
        report('storage', `missing object ${o.key}`);
        error(500, 'The archive is missing from storage; the Worker log says which.');
    }
    return new Response(got.body, {
        headers: {
            'content-type': 'application/gzip',
            'content-length': String(got.size),
            'content-disposition': `attachment; filename="${o.filename.replace(/["\\\r\n]/g, '_')}"`,
            'cache-control': 'private, no-store',
        },
    });
}

/** Sends the caller to `url`, a presigned URL on the bucket, and nowhere
 *  else. SvelteKit 3 refuses a redirect to another origin unless it is
 *  named; naming the bucket's public origin, not allowing every external
 *  URL, means a bug that built the wrong URL is a 500, not an open
 *  redirect. */
export function toBucket(ctx: Context, url: URL): never {
    redirect(302, url.toString(), { external: [new URL(ctx.config.s3.publicEndpoint).origin] });
}
