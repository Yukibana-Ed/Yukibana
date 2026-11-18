/** GitHub, as the project page asks it when an owner links a repository
 *  (docs/cloud/github.md, Stage 3).
 *
 *  Every call is made with the person's own user-to-server token from the
 *  Yukibana Cloud GitHub App, which can do only what both the App and the
 *  person may, and the App may only read repository metadata. So nothing
 *  here can change anything on GitHub except the token itself (revoking
 *  it). Two facts come out of it, and the database decides from them:
 *  "this person administers repository R of owner O" (`mayLink`), and
 *  GitHub's numeric ids for R and O, which a link binds to.
 *
 *  `GitHub` is an interface so the tests stub it; `githubClient` is the one
 *  implementation, over `fetch`. Every answer is narrowed from `unknown` at
 *  this boundary by the pure functions below (`repositoryOf` and the rest),
 *  which are tested against responses recorded from GitHub. Nothing here
 *  logs a token.
 */

/** A repository as GitHub describes it to the person asking. */
export interface Repository {
    /** GitHub's numeric id of the repository, as decimal digits: what a link
     *  binds to. It survives a rename and is never reused. */
    readonly id: string;
    /** GitHub's numeric id of its owner (a user or an organisation), as
     *  decimal digits: it changes when the repository is transferred. */
    readonly ownerId: string;
    /** `owner/name` as it is now: for display, never for deciding. */
    readonly fullName: string;
    /** Whether it is private, for the picker. */
    readonly private: boolean;
    /** Whether the person asking has `admin` on it. */
    readonly admin: boolean;
    /** Whether the person asking has `maintain` on it. */
    readonly maintain: boolean;
}

/** An installation of the App the person can see: an account (theirs or an
 *  organisation's) on which they or somebody else installed it. */
export interface Installation {
    /** GitHub's numeric id of the installation. */
    readonly id: number;
    /** The account's login, for display. */
    readonly account: string;
}

/** One page of an installation's repositories, as the person can see them. */
export interface RepositoryPage {
    /** The repositories on the page, in GitHub's order. */
    readonly repositories: readonly Repository[];
    /** How many there are in all (`total_count`): more than are listed when
     *  the installation has more than one page. */
    readonly total: number;
}

/** GitHub refused or failed a request: a status that is not the one
 *  expected, an answer this module cannot read, or no answer at all. The
 *  message is a sentence for the Worker log and, through `report`, for the
 *  person; it never includes a token. `status` is GitHub's, or 0 when it
 *  did not answer. */
export class GitHubError extends Error {
    override readonly name = 'GitHubError';
    constructor(
        message: string,
        readonly status: number,
    ) {
        super(message);
    }
}

/** What the Worker asks GitHub, with the person's token. Every method
 *  throws a `GitHubError` when GitHub fails or refuses, except where it says
 *  it returns null. */
export interface GitHub {
    /** Trades the `code` GitHub sent back to `/auth/github/return` for the
     *  person's user-to-server token. A code GitHub refuses (expired, used,
     *  for another client) is a `GitHubError`. */
    exchangeCode(code: string): Promise<string>;
    /** The installations of the App the person can see, the first page of
     *  up to 100 (`GET /user/installations`). */
    installations(token: string): Promise<readonly Installation[]>;
    /** The first page of up to 100 repositories of `installation` the person
     *  can see (`GET /user/installations/{id}/repositories`). */
    installationRepositories(token: string, installation: number): Promise<RepositoryPage>;
    /** The repository with GitHub's id `id`, or null when it does not exist
     *  or the person cannot see it through the App (`GET /repositories/{id}`). */
    repositoryById(token: string, id: string): Promise<Repository | null>;
    /** The repository `owner/name`, or null when it does not exist or the
     *  person cannot see it through the App (`GET /repos/{owner}/{name}`). */
    repositoryByName(token: string, fullName: string): Promise<Repository | null>;
    /** Revokes `token` (`DELETE /applications/{client_id}/token`), so it is
     *  worth nothing even to somebody who copied the cookie. A token already
     *  revoked or expired is not an error. */
    revokeToken(token: string): Promise<void>;
}

/** True iff the person may link `repo`: they administer it (`admin`) or
 *  maintain it (`maintain`). Linking is proof of control because a link
 *  makes the repository's CI publish to the project: without it a stranger
 *  could link somebody's private course repository to a project of their
 *  own, and that repository's next tag would send its hidden tests there.
 *  `push` alone is not enough: a collaborator who may push may not decide
 *  where the repository publishes. */
export const mayLink = (repo: Repository): boolean => repo.admin || repo.maintain;

/** What a typed `owner/name` must look like before it is sent to GitHub:
 *  GitHub's own alphabet for owners (no dot) and names, one slash, and a
 *  name that is not `.` or `..`. Anything else would change the path asked
 *  for: `../user` once passed a looser pattern and asked GitHub for
 *  `/user`. */
export const REPOSITORY_NAME = /^[A-Za-z0-9_-]+\/(?!\.\.?$)[A-Za-z0-9_.-]+$/;

/** What GitHub's numeric ids look like here: decimal digits, as the
 *  database's check constraints want them. */
const DIGITS = /^[0-9]{1,20}$/;

const record = (v: unknown): Record<string, unknown> | null => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** A numeric id as GitHub sends it (a JSON number) as decimal digits, or
 *  null for anything else. A string of digits is accepted too, as the OIDC
 *  token's claims are strings. */
function idOf(v: unknown): string | null {
    if (typeof v === 'number' && Number.isSafeInteger(v) && v > 0) return String(v);
    if (typeof v === 'string' && DIGITS.test(v)) return v;
    return null;
}

/** Returns the repository GitHub described in `v` (a repository object of
 *  its REST API), or null when `v` lacks a numeric `id`, an `owner.id`, a
 *  `full_name` shaped like `owner/name` or `private`. A repository without
 *  `permissions` (an answer not made for a person) has neither admin nor
 *  maintain, so it cannot be linked. */
export function repositoryOf(v: unknown): Repository | null {
    const r = record(v);
    if (r === null) return null;
    const id = idOf(r['id']);
    const ownerId = idOf(record(r['owner'])?.['id']);
    const fullName = r['full_name'];
    if (id === null || ownerId === null || typeof fullName !== 'string' || !REPOSITORY_NAME.test(fullName) || typeof r['private'] !== 'boolean') return null;
    const permissions = record(r['permissions']);
    return { id, ownerId, fullName, private: r['private'], admin: permissions?.['admin'] === true, maintain: permissions?.['maintain'] === true };
}

/** Returns the installations in `v`, the answer of `GET /user/installations`,
 *  or null when it is not one. An installation without a numeric id is
 *  skipped; one whose account has no login is shown by its id. */
export function installationsOf(v: unknown): Installation[] | null {
    const list = record(v)?.['installations'];
    if (!Array.isArray(list)) return null;
    return list.flatMap((i): Installation[] => {
        const r = record(i);
        const id = r?.['id'];
        if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) return [];
        const login = record(r?.['account'])?.['login'];
        return [{ id, account: typeof login === 'string' ? login : `installation ${id}` }];
    });
}

/** Returns the page in `v`, the answer of
 *  `GET /user/installations/{id}/repositories`, or null when it is not one.
 *  A repository `repositoryOf` cannot read is skipped. `total` is at least
 *  the number listed. */
export function repositoryPageOf(v: unknown): RepositoryPage | null {
    const r = record(v);
    const list = r?.['repositories'];
    if (r === null || !Array.isArray(list)) return null;
    const repositories = list.map(repositoryOf).filter((x): x is Repository => x !== null);
    const total = typeof r['total_count'] === 'number' ? r['total_count'] : list.length;
    return { repositories, total: Math.max(total, list.length) };
}

/** Returns the token in `v`, the answer of GitHub's code exchange, or why
 *  there is none, as GitHub said it. GitHub answers a refused code with a
 *  200 and an `error`, so the status alone says nothing. */
export function accessTokenOf(v: unknown): { token: string } | { refused: string } {
    const r = record(v);
    const token = r?.['access_token'];
    if (typeof token === 'string' && token !== '') return { token };
    const why = r?.['error_description'] ?? r?.['error'];
    return { refused: typeof why === 'string' ? why : 'GitHub answered without a token' };
}

/** GitHub's addresses: the API, and the site where the OAuth endpoints are. */
const API = 'https://api.github.com';
const SITE = 'https://github.com';

/** The headers GitHub's REST API asks every client to send. A Worker's
 *  `fetch` sends no User-Agent of its own, and GitHub refuses a request
 *  without one. */
const HEADERS = { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'yukibana-cloud' } as const;

/** A sentence for GitHub's refusal `res`, with its own message when it gave
 *  one, and the reset time when the refusal is a rate limit. */
async function refusal(what: string, res: Response): Promise<GitHubError> {
    const body = record(await res.json().catch(() => null));
    const said = typeof body?.['message'] === 'string' ? `: ${body['message']}` : '';
    const limited = (res.status === 403 || res.status === 429) && res.headers.get('x-ratelimit-remaining') === '0';
    const reset = Number(res.headers.get('x-ratelimit-reset'));
    const until = limited && Number.isFinite(reset) && reset > 0 ? ` (rate limited until ${new Date(reset * 1000).toISOString()})` : '';
    return new GitHubError(`GitHub answered ${res.status} to ${what}${said}${until}`, res.status);
}

/** Returns the GitHub client for the App with OAuth client `clientId` and
 *  `clientSecret`, over `fetchFn` (the Worker's `fetch`, or a test's). Each
 *  method makes exactly one request. */
export function githubClient(app: { readonly clientId: string; readonly clientSecret: string }, fetchFn: typeof fetch = fetch): GitHub {
    const send = async (what: string, url: string, init: RequestInit): Promise<Response> => {
        try {
            return await fetchFn(url, init);
        } catch (e) {
            throw new GitHubError(`GitHub did not answer ${what}: ${e instanceof Error ? e.message : String(e)}`, 0);
        }
    };
    const get = async (what: string, token: string, path: string, missing: 'null' | 'throw'): Promise<unknown> => {
        const res = await send(what, `${API}${path}`, { headers: { ...HEADERS, authorization: `Bearer ${token}` } });
        if (res.status === 404 && missing === 'null') {
            await res.body?.cancel();
            return null;
        }
        if (res.status !== 200) throw await refusal(what, res);
        return res.json().catch(() => {
            throw new GitHubError(`GitHub answered ${what} with something that is not JSON`, res.status);
        });
    };
    const repository = async (what: string, token: string, path: string): Promise<Repository | null> => {
        const v = await get(what, token, path, 'null');
        if (v === null) return null;
        const repo = repositoryOf(v);
        if (repo === null) throw new GitHubError(`GitHub answered ${what} with something that is not a repository`, 200);
        return repo;
    };
    return {
        async exchangeCode(code) {
            const what = 'the code exchange';
            const res = await send(what, `${SITE}/login/oauth/access_token`, {
                method: 'POST',
                headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': HEADERS['user-agent'] },
                body: JSON.stringify({ client_id: app.clientId, client_secret: app.clientSecret, code }),
            });
            if (res.status !== 200) throw await refusal(what, res);
            const got = accessTokenOf(await res.json().catch(() => null));
            if ('refused' in got) throw new GitHubError(`GitHub refused the code: ${got.refused}`, res.status);
            return got.token;
        },
        async installations(token) {
            const what = 'the list of installations';
            const v = installationsOf(await get(what, token, '/user/installations?per_page=100', 'throw'));
            if (v === null) throw new GitHubError(`GitHub answered ${what} with something that is not one`, 200);
            return v;
        },
        async installationRepositories(token, installation) {
            const what = `the repositories of installation ${installation}`;
            const v = repositoryPageOf(await get(what, token, `/user/installations/${installation}/repositories?per_page=100`, 'throw'));
            if (v === null) throw new GitHubError(`GitHub answered ${what} with something that is not a list of repositories`, 200);
            return v;
        },
        async repositoryById(token, id) {
            if (!DIGITS.test(id)) return null;
            return repository(`repository ${id}`, token, `/repositories/${id}`);
        },
        async repositoryByName(token, fullName) {
            if (!REPOSITORY_NAME.test(fullName)) return null;
            return repository(fullName, token, `/repos/${fullName}`);
        },
        async revokeToken(token) {
            const what = 'the token revocation';
            const res = await send(what, `${API}/applications/${encodeURIComponent(app.clientId)}/token`, {
                method: 'DELETE',
                headers: { ...HEADERS, authorization: `Basic ${btoa(`${app.clientId}:${app.clientSecret}`)}`, 'content-type': 'application/json' },
                body: JSON.stringify({ access_token: token }),
            });
            // 404: the token is already revoked or expired, which is what was asked.
            if (res.status === 204 || res.status === 404) {
                await res.body?.cancel();
                return;
            }
            throw await refusal(what, res);
        },
    };
}
