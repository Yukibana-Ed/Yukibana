/** The Worker's configuration, read and checked each time it is asked for
 *  (`workerConfig` in #lib/server/worker; cheap, and nothing caches it).
 *
 *  The Worker's env is whatever wrangler.jsonc, `wrangler secret` and .dev.vars
 *  put there, untyped. This is the one place that looks at it. A value that
 *  is missing fails here with its name, so "S3_SECRET_ACCESS_KEY is not set"
 *  is the error, not a signature the bucket refuses.
 */

/** Where the bucket is and how to sign for it: R2 in production, RustFS
 *  locally (see `s3Bucket` in #lib/server/storage). */
export interface S3Config {
    /** Where the Worker talks to the bucket. */
    readonly endpoint: string;
    /** Where a browser talks to it, for presigned URLs. The same as `endpoint`
     *  in production; in a devcontainer the two are different machines. */
    readonly publicEndpoint: string;
    /** The bucket's name. */
    readonly bucket: string;
    /** The region to sign for (`auto` for R2). */
    readonly region: string;
    /** The access key's id. */
    readonly accessKeyId: string;
    /** The access key's secret. A secret: never logged or answered with. */
    readonly secretAccessKey: string;
}

/** Everything the Worker is configured with.
 *
 *  Invariant: made by `configOf`, so every string is non-empty and both
 *  byte limits are positive whole numbers. */
export interface Config {
    /** The Postgres connection string: Hyperdrive's when it is bound, else
     *  `DATABASE_URL`. It must connect as `yukibana_app`, and nothing here
     *  checks that. Only `asPublisher` (publishing with a project token)
     *  notices a wrong role, by throwing `Misconfigured`: `asUser` does not,
     *  because `postgres`, the role of the string Supabase's dashboard
     *  offers, is a member of `authenticated`, so on it every page works
     *  with the policies off for the tables it owns. A secret. */
    readonly databaseUrl: string;
    /** The Supabase project's address, where Auth is (`PUBLIC_SUPABASE_URL`). */
    readonly supabaseUrl: string;
    /** Supabase's publishable key, which the Auth client sends. Not a secret. */
    readonly supabasePublishableKey: string;
    /** The id of the registry's client on Supabase Auth's OAuth 2.1 server,
     *  through which a terminal or an IDE logs in by way of the website
     *  (`/auth/connect`, see #lib/connect). Not a secret: the client is
     *  public, and PKCE is what protects its codes. Null where none is
     *  registered: the CLI then falls back to logging in with GitHub
     *  directly, as before. */
    readonly oauthClientId: string | null;
    /** The site's canonical address, which must be Auth's `site_url`: the
     *  IDE login works only there (see #lib/connect), so `/auth/connect`
     *  moves to it and `/api/auth/config` tells the CLI. Null where the site
     *  is wherever it was asked (development). */
    readonly siteUrl: string | null;
    /** The bucket. */
    readonly s3: S3Config;
    /** The largest submission body the API accepts, in bytes, whatever the project says. */
    readonly submissionMaxBytes: number;
    /** The largest archive a release may carry, in bytes, each. Keeping two
     *  of them (and the form around them) under the platform's request body
     *  limit is the operator's job and is not checked here; when it is set
     *  too high, a release near the limit is refused by the platform before
     *  the Worker sees the request, so the 413 this value exists to give is
     *  never given. */
    readonly releaseMaxBytes: number;
}

function text(env: Record<string, unknown>, name: string): string {
    const v = env[name];
    if (typeof v !== 'string' || v === '') throw new Error(`${name} is not set`);
    return v;
}

/** An optional value: unset and empty are both null. */
function optional(env: Record<string, unknown>, name: string): string | null {
    const v = env[name];
    return typeof v === 'string' && v !== '' ? v : null;
}

/** A byte limit: a positive whole number written in decimal digits, and
 *  nothing else. `parseInt` alone read "32MB" as 32 and "" as NaN, and a
 *  NaN limit refuses nothing: every comparison with it is false. */
function bytes(env: Record<string, unknown>, name: string): number {
    const v = text(env, name);
    const n = /^[0-9]+$/.test(v) ? Number(v) : Number.NaN;
    if (!Number.isSafeInteger(n) || n <= 0) throw new Error(`${name} is not a positive whole number of bytes ("${v}")`);
    return n;
}

/** Returns the configuration in `env`.
 *
 *  - Requires: every value `Config` does not make optional is set and
 *    non-empty, and the two byte limits are positive whole numbers; throws
 *    an Error naming the first that is not (`S3_BUCKET is not set`). Set
 *    but empty is unset. `S3_PUBLIC_ENDPOINT` unset is `S3_ENDPOINT`;
 *    `SUPABASE_OAUTH_CLIENT_ID` and `SITE_URL` unset are null. Values are
 *    not checked beyond that: an address that is not one fails where it is
 *    used. */
export function configOf(env: Cloudflare.Env): Config {
    const databaseUrl = env.HYPERDRIVE?.connectionString ?? text(env, 'DATABASE_URL');
    return {
        databaseUrl,
        supabaseUrl: text(env, 'PUBLIC_SUPABASE_URL'),
        supabasePublishableKey: text(env, 'SUPABASE_PUBLISHABLE_KEY'),
        oauthClientId: optional(env, 'SUPABASE_OAUTH_CLIENT_ID'),
        siteUrl: optional(env, 'SITE_URL'),
        s3: {
            endpoint: text(env, 'S3_ENDPOINT'),
            publicEndpoint: typeof env['S3_PUBLIC_ENDPOINT'] === 'string' && env['S3_PUBLIC_ENDPOINT'] !== '' ? env['S3_PUBLIC_ENDPOINT'] : text(env, 'S3_ENDPOINT'),
            bucket: text(env, 'S3_BUCKET'),
            region: text(env, 'S3_REGION'),
            accessKeyId: text(env, 'S3_ACCESS_KEY_ID'),
            secretAccessKey: text(env, 'S3_SECRET_ACCESS_KEY'),
        },
        submissionMaxBytes: bytes(env, 'SUBMISSION_MAX_BYTES'),
        releaseMaxBytes: bytes(env, 'RELEASE_MAX_BYTES'),
    };
}
