/** A CI job's proof of where it runs: GitHub Actions' OIDC token.
 *
 *  A repository's own workflow asks GitHub for a token whose audience is
 *  this registry's origin, and sends it as its bearer. Verified here
 *  (issuer, audience, signature, expiry), it says "this job runs in
 *  repository R of owner O, at ref F, on commit S", as GitHub's numeric ids,
 *  and nothing else: that is the `CiIdentity` the database decides from
 *  (`app.ci_projects`, `app.publish_release_with_repository`), exactly as a
 *  verified Supabase JWT becomes `request.jwt.claims`. What the token proves
 *  is taken from the token, never from the request's body.
 *
 *  Only GitHub Actions' public issuer is accepted. GitHub Enterprise's
 *  custom issuers, and any other forge, are refused like any other issuer:
 *  a second forge is a migration and an adapter here (docs/cloud/github.md).
 */

import { createRemoteJWKSet, decodeJwt, decodeProtectedHeader, errors, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose';
import { error } from '@sveltejs/kit';
import { report } from '#lib/report.ts';

/** The one issuer a CI token may have: GitHub Actions on github.com. */
export const GITHUB_ACTIONS_ISSUER = 'https://token.actions.githubusercontent.com';

/** GitHub Actions' published signing keys, fetched when first needed and
 *  cached by jose for the life of the isolate. Creating it fetches nothing,
 *  so importing this module costs no request. */
export const githubKeys: JWTVerifyGetKey = createRemoteJWKSet(new URL(`${GITHUB_ACTIONS_ISSUER}/.well-known/jwks`));

/** The events whose runs may publish. An allow list: npm learned with
 *  `issue_comment` that a deny list misses one. A `pull_request` run, from a
 *  fork's branch or not, publishes nothing. */
const PUBLISHING_EVENTS: ReadonlySet<string> = new Set<CiIdentity['event']>(['push', 'workflow_dispatch']);

/** What a verified CI token says about the job that holds it. Every field
 *  is the token's claim, as GitHub signed it. */
export interface CiIdentity {
    /** GitHub's numeric id of the repository (`repository_id`), as decimal
     *  digits. What a link binds to: it survives a rename and is not reused. */
    readonly repositoryId: string;
    /** GitHub's numeric id of the repository's owner (`repository_owner_id`),
     *  as decimal digits; it changes when the repository is transferred,
     *  which breaks its links. */
    readonly ownerId: string;
    /** The repository's current `owner/name` (`repository`), for display and
     *  for a release's `published_from`; nothing is decided by it. */
    readonly repository: string;
    /** The git ref the job runs at (`ref`), such as `refs/tags/v1` or
     *  `refs/heads/main`. Whether it may publish (only tags) is the
     *  database's decision, not this module's. */
    readonly ref: string;
    /** The commit the job runs at (`sha`): 40 (or, for SHA-256 repositories,
     *  64) lowercase hex digits. A release by link records this commit and
     *  no other. */
    readonly sha: string;
    /** The event that started the run (`event_name`): one of the events
     *  that may publish, and no other. */
    readonly event: 'push' | 'workflow_dispatch';
}

const claim = (payload: Record<string, unknown>, name: string): string | null => {
    const v = payload[name];
    return typeof v === 'string' && v !== '' ? v : null;
};

/** Returns the identity in `payload`, the claims of a token already verified,
 *  or a sentence saying why it names none: a claim missing or of the wrong
 *  shape (named), or an event that may not publish. Pure; it checks no
 *  signature, issuer, audience or time, which `verifyCiToken` does first. */
export function ciIdentityOf(payload: Readonly<Record<string, unknown>>): CiIdentity | string {
    const repositoryId = claim(payload, 'repository_id');
    if (repositoryId === null || !/^[0-9]+$/.test(repositoryId)) return 'its repository_id claim is missing or not a number';
    const ownerId = claim(payload, 'repository_owner_id');
    if (ownerId === null || !/^[0-9]+$/.test(ownerId)) return 'its repository_owner_id claim is missing or not a number';
    const repository = claim(payload, 'repository');
    if (repository === null || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) return 'its repository claim is missing or not owner/name';
    const ref = claim(payload, 'ref');
    if (ref === null || !ref.startsWith('refs/')) return 'its ref claim is missing or not a git ref';
    const sha = claim(payload, 'sha')?.toLowerCase() ?? null;
    if (sha === null || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(sha)) return 'its sha claim is missing or not a commit';
    const event = claim(payload, 'event_name');
    if (event === null) return 'its event_name claim is missing';
    if (!PUBLISHING_EVENTS.has(event)) return `a ${event} run does not publish; only push and workflow_dispatch runs do`;
    return { repositoryId, ownerId, repository, ref, sha, event: event as CiIdentity['event'] };
}

/** Returns the issuer `token` claims, unverified, or null when it is not a
 *  JWT or names none. A routing hint and nothing more: nothing it returns
 *  may be trusted, and every CI route verifies the token itself. */
export function issuerOf(token: string): string | null {
    try {
        const iss = decodeJwt(token).iss;
        return typeof iss === 'string' ? iss : null;
    } catch {
        return null;
    }
}

/** True iff `bearer` claims, unverified, to come from GitHub Actions: a
 *  routing hint, so that a CI route sends it to `verifyCiToken` and the
 *  session code does not take it for a bad session. It proves nothing. */
export const isCiToken = (bearer: string): boolean => issuerOf(bearer) === GITHUB_ACTIONS_ISSUER;

/** What the cheap checks find wrong with `token` before any key is fetched,
 *  or null. They read the token unverified, so they can only refuse, never
 *  accept; jose checks the same again on the verified claims. They exist so
 *  that a token for another registry, another issuer or an expired one is
 *  refused without a request to GitHub, and in the words a teacher needs. */
function precheck(token: string, audience: string, now: number): string | null {
    let payload: JWTPayload;
    let alg: unknown;
    try {
        alg = decodeProtectedHeader(token).alg;
        payload = decodeJwt(token);
    } catch {
        return 'it is not a JWT';
    }
    if (payload.iss !== GITHUB_ACTIONS_ISSUER)
        return `it was issued by ${typeof payload.iss === 'string' ? payload.iss : 'nobody'}; this registry accepts only ${GITHUB_ACTIONS_ISSUER}`;
    const aud = typeof payload.aud === 'string' ? [payload.aud] : (payload.aud ?? []);
    if (!aud.includes(audience)) return `this token is for ${aud.length === 0 ? 'no audience' : aud.join(', ')}; this registry expects ${audience}`;
    if (alg !== 'RS256') return `it is signed with ${typeof alg === 'string' ? alg : 'no algorithm'}, not RS256`;
    if (typeof payload.exp !== 'number') return 'it has no expiry';
    if (payload.exp <= now) return `it expired at ${new Date(payload.exp * 1000).toISOString()}; ask GitHub for a fresh one for each request`;
    return null;
}

/** Returns the identity in `token` once it is verified, or a sentence saying
 *  why it is refused, for "CI token refused: <sentence>".
 *
 *  Verified means: issued by `GITHUB_ACTIONS_ISSUER`, for `audience` (this
 *  registry's canonical origin, `siteOrigin` in #lib/server/connect, with no
 *  trailing slash), signed with RS256 by a key in `keys`, not expired, and
 *  naming an identity `ciIdentityOf` accepts. A refusal for the audience
 *  names the one expected, so a job that asked for the wrong one can see
 *  which to ask for; one for the issuer names the issuer accepted.
 *
 *  `keys` is GitHub's published key set in production; the integration
 *  suite passes a local one and signs its own tokens. A key set that cannot
 *  be fetched is not the token's fault: it is reported and thrown as a 503,
 *  never answered as a refusal. */
export async function verifyCiToken(token: string, audience: string, keys: JWTVerifyGetKey = githubKeys): Promise<CiIdentity | string> {
    const early = precheck(token, audience, Math.floor(Date.now() / 1000));
    if (early !== null) return early;
    let payload: JWTPayload;
    try {
        ({ payload } = await jwtVerify(token, keys, { issuer: GITHUB_ACTIONS_ISSUER, audience, algorithms: ['RS256'] }));
    } catch (e) {
        if (e instanceof errors.JWTExpired) return 'it has expired; ask GitHub for a fresh one for each request';
        if (e instanceof errors.JWTClaimValidationFailed) return `its ${e.claim} claim is not acceptable (${e.reason})`;
        if (e instanceof errors.JWSSignatureVerificationFailed) return 'its signature is not valid';
        if (e instanceof errors.JWKSNoMatchingKey || e instanceof errors.JWKSMultipleMatchingKeys) return 'it is not signed by a key GitHub publishes';
        if (e instanceof errors.JWKSTimeout || !(e instanceof errors.JOSEError)) {
            report('oidc', `GitHub's signing keys could not be read: ${e instanceof Error ? e.message : String(e)}`);
            error(503, "GitHub's signing keys could not be read; try the job again.");
        }
        return `it could not be verified (${e.code})`;
    }
    return ciIdentityOf(payload);
}
