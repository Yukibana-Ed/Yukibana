/** A GitHub Actions job's OIDC token, which `publish --ci` sends as its
 *  bearer instead of a project token.
 *
 *  GitHub gives a job that has `permissions: id-token: write` two variables,
 *  `ACTIONS_ID_TOKEN_REQUEST_URL` and `ACTIONS_ID_TOKEN_REQUEST_TOKEN`; a GET
 *  to the first, with `audience` added and the second as its bearer,
 *  answers `{ "value": "<jwt>" }`. The token names the repository, its
 *  owner, the ref and the commit, signed by GitHub, and the registry
 *  believes those and nothing the job says about itself.
 */

/** Why no OIDC token could be had, as a sentence for the job log. Never
 *  carries either token: the request token is a credential for minting
 *  more, and the OIDC token one for publishing. */
export class OidcUnavailable extends Error {}

/** The sentence for a job that was not given the two variables. */
export const NO_ID_TOKEN =
    'this job cannot ask GitHub for an OIDC token (ACTIONS_ID_TOKEN_REQUEST_URL and ACTIONS_ID_TOKEN_REQUEST_TOKEN are not set); give the workflow `permissions: id-token: write`, and run it on GitHub Actions';

/** Returns the URL to ask GitHub for a token for `audience` at: the job's
 *  request URL with `audience` set as a query parameter (replacing any
 *  there), escaped, so an audience is never read as more of the query.
 *  Throws `OidcUnavailable` when `requestUrl` is not a URL. Pure. */
export function oidcRequestUrl(requestUrl: string, audience: string): string {
    let url: URL;
    try {
        url = new URL(requestUrl);
    } catch {
        throw new OidcUnavailable('ACTIONS_ID_TOKEN_REQUEST_URL is not a URL; this job was not started by GitHub Actions as it expects');
    }
    url.searchParams.set('audience', audience);
    return url.toString();
}

/** Returns the token in GitHub's answer `body` (`{ value }`), or throws
 *  `OidcUnavailable` naming what is wrong with it, never quoting it. Pure. */
export function oidcTokenOf(body: unknown): string {
    const value = typeof body === 'object' && body !== null && 'value' in body ? body.value : undefined;
    if (typeof value !== 'string' || value.split('.').length !== 3) throw new OidcUnavailable('GitHub answered the OIDC token request without a token');
    return value;
}

/** Returns a fresh OIDC token for `audience` (the registry's origin, which
 *  the registry checks against its own), asked of GitHub with the job's
 *  variables in `env` and sent with `fetchFn`. One request per call: a
 *  token lives a few minutes, so a caller asks again for each request it
 *  sends rather than keeping one across a build. Throws `OidcUnavailable`
 *  when the variables are missing (`NO_ID_TOKEN`) or GitHub does not give
 *  a token, with GitHub's status; what `fetchFn` throws is thrown as it is. */
export async function requestOidcToken(env: NodeJS.ProcessEnv, audience: string, fetchFn: typeof fetch = fetch): Promise<string> {
    const requestUrl = env['ACTIONS_ID_TOKEN_REQUEST_URL'];
    const requestToken = env['ACTIONS_ID_TOKEN_REQUEST_TOKEN'];
    if (requestUrl === undefined || requestUrl === '' || requestToken === undefined || requestToken === '') throw new OidcUnavailable(NO_ID_TOKEN);
    const res = await fetchFn(oidcRequestUrl(requestUrl, audience), { headers: { authorization: `bearer ${requestToken}`, accept: 'application/json' } });
    if (!res.ok) {
        await res.body?.cancel();
        throw new OidcUnavailable(`GitHub refused the OIDC token request with ${res.status}; does the workflow have \`permissions: id-token: write\`?`);
    }
    let body: unknown;
    try {
        body = await res.json();
    } catch {
        throw new OidcUnavailable('GitHub answered the OIDC token request with something other than JSON');
    }
    return oidcTokenOf(body);
}
