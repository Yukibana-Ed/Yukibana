import { test, expect } from 'vitest';
import { accessTokenOf, githubClient, GitHubError, installationsOf, mayLink, repositoryOf, repositoryPageOf, type GitHub, type Repository } from '../src/lib/server/github';
import { MAX_INSTALLATIONS, authorizeUrlOf, installUrlOf, pickerFor, returned, wantedOf } from '../src/lib/server/github-link';
import { cookieKey, openToken, sealState } from '../src/lib/server/github-cookie';
import type { EditionId, ProjectId } from '../src/lib/ids';

// Answers as GitHub's REST API gives them (2022-11-28), trimmed to the
// fields that matter and a few that do not.
const RECORDED_REPOSITORY = {
    id: 812345678,
    node_id: 'R_kgDOMG3qzg',
    name: 'intro-exercise',
    full_name: 'heig-isc/intro-exercise',
    private: true,
    owner: { login: 'heig-isc', id: 98765432, type: 'Organization' },
    html_url: 'https://github.com/heig-isc/intro-exercise',
    permissions: { admin: false, maintain: true, push: true, triage: true, pull: true },
};
const RECORDED_INSTALLATIONS = {
    total_count: 2,
    installations: [
        { id: 55501, account: { login: 'heig-isc', id: 98765432, type: 'Organization' }, repository_selection: 'selected' },
        { id: 55502, account: { login: 'luis', id: 1234, type: 'User' }, repository_selection: 'all' },
    ],
};
const RECORDED_PAGE = {
    total_count: 2,
    repository_selection: 'selected',
    repositories: [
        RECORDED_REPOSITORY,
        { ...RECORDED_REPOSITORY, id: 812345679, full_name: 'heig-isc/other', permissions: { admin: false, maintain: false, push: true, pull: true } },
    ],
};

const repo = (over: Partial<Repository> = {}): Repository => ({ id: '1', ownerId: '10', fullName: 'o/r', private: false, admin: true, maintain: false, ...over });

test("GitHub's description of a repository is read as its ids, its name and the asker's permissions, and nothing else is a repository", () => {
    expect(repositoryOf(RECORDED_REPOSITORY)).toEqual({ id: '812345678', ownerId: '98765432', fullName: 'heig-isc/intro-exercise', private: true, admin: false, maintain: true });
    expect(repositoryOf({ ...RECORDED_REPOSITORY, permissions: undefined })).toMatchObject({ admin: false, maintain: false });
    for (const [why, bad] of [
        ['no id', { ...RECORDED_REPOSITORY, id: undefined }],
        ['a fractional id', { ...RECORDED_REPOSITORY, id: 1.5 }],
        ['no owner', { ...RECORDED_REPOSITORY, owner: null }],
        ['an owner id that is not a number', { ...RECORDED_REPOSITORY, owner: { id: 'x' } }],
        ['a name with a path in it', { ...RECORDED_REPOSITORY, full_name: 'a/b/../c' }],
        ['no private flag', { ...RECORDED_REPOSITORY, private: 'yes' }],
        ['an array', [RECORDED_REPOSITORY]],
        ['null', null],
    ] as const)
        expect(repositoryOf(bad), why).toBeNull();
});

test('the installations and the repositories of one are read from what GitHub lists, skipping what cannot be read', () => {
    expect(installationsOf(RECORDED_INSTALLATIONS)).toEqual([
        { id: 55501, account: 'heig-isc' },
        { id: 55502, account: 'luis' },
    ]);
    expect(installationsOf({ installations: [{ id: 'x' }, { id: 7 }] })).toEqual([{ id: 7, account: 'installation 7' }]);
    expect(installationsOf({ message: 'Bad credentials' })).toBeNull();
    const page = repositoryPageOf(RECORDED_PAGE);
    expect(page?.total).toBe(2);
    expect(page?.repositories.map(r => r.fullName)).toEqual(['heig-isc/intro-exercise', 'heig-isc/other']);
    expect(repositoryPageOf({ total_count: 500, repositories: [{ id: 'junk' }] })).toEqual({ repositories: [], total: 500 });
    expect(repositoryPageOf({})).toBeNull();
});

test('a code GitHub refuses comes back as its reason, though GitHub answers it with a 200', () => {
    expect(accessTokenOf({ access_token: 'ghu_x', token_type: 'bearer', scope: '' })).toEqual({ token: 'ghu_x' });
    expect(accessTokenOf({ error: 'bad_verification_code', error_description: 'The code passed is incorrect or expired.' })).toEqual({
        refused: 'The code passed is incorrect or expired.',
    });
    expect(accessTokenOf(null)).toEqual({ refused: 'GitHub answered without a token' });
});

test('only a person who administers or maintains a repository may link it; pushing to it is not enough', () => {
    expect(mayLink(repo({ admin: true, maintain: false }))).toBe(true);
    expect(mayLink(repo({ admin: false, maintain: true }))).toBe(true);
    expect(mayLink(repo({ admin: false, maintain: false }))).toBe(false);
});

test('the link form names a repository by id or by owner/name, and nothing that would change the path asked of GitHub', () => {
    expect(wantedOf('812345678', '')).toEqual({ id: '812345678' });
    expect(wantedOf('812345678', 'a/b')).toEqual({ id: '812345678' });
    expect(wantedOf('', 'heig-isc/intro-exercise')).toEqual({ name: 'heig-isc/intro-exercise' });
    expect(wantedOf('', 'https://github.com/heig-isc/intro-exercise.git')).toEqual({ name: 'heig-isc/intro-exercise' });
    for (const [id, name] of [
        ['12a', ''],
        ['', ''],
        ['', 'heig-isc'],
        ['', '../../user'],
        ['', 'a/b/c'],
        ['', 'a/b?x=1'],
        ['', 'owner/..'],
        ['', '.well-known/x'],
        ['', 'https://evil.example/a/b'],
    ] as const)
        expect(typeof wantedOf(id, name), `${id} ${name}`).toBe('string');
});

test("Connect goes to GitHub's authorize page with the site's callback, and the install button to the App's installation page, each with the state", () => {
    const authorize = authorizeUrlOf('Iv1.abc', 'https://cloud.example', 'S7ATE');
    expect(`${authorize.origin}${authorize.pathname}`).toBe('https://github.com/login/oauth/authorize');
    expect(Object.fromEntries(authorize.searchParams)).toEqual({ client_id: 'Iv1.abc', redirect_uri: 'https://cloud.example/auth/github/return', state: 'S7ATE' });
    expect(installUrlOf('yukibana-cloud', 'S7ATE').toString()).toBe('https://github.com/apps/yukibana-cloud/installations/new?state=S7ATE');
});

/** A fetch that answers from `routes` by method and URL, and records what it was asked. */
function fakeFetch(routes: Record<string, () => Response>): { fetchFn: typeof fetch; asked: { method: string; url: string; headers: Headers; body: string }[] } {
    const asked: { method: string; url: string; headers: Headers; body: string }[] = [];
    const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        asked.push({ method, url, headers: new Headers(init?.headers), body: typeof init?.body === 'string' ? init.body : '' });
        const route = routes[`${method} ${url}`];
        if (route === undefined) throw new Error(`unexpected ${method} ${url}`);
        return route();
    }) as typeof fetch;
    return { fetchFn, asked };
}
const json = (v: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json', ...headers } });
const app = { clientId: 'Iv1.abc', clientSecret: 'shh' };

test("the GitHub client asks GitHub's API with the person's token and a User-Agent, and reads a missing repository as none", async () => {
    const { fetchFn, asked } = fakeFetch({
        'GET https://api.github.com/repositories/812345678': () => json(RECORDED_REPOSITORY),
        'GET https://api.github.com/repos/heig-isc/gone': () => json({ message: 'Not Found' }, 404),
        'GET https://api.github.com/user/installations?per_page=100': () => json(RECORDED_INSTALLATIONS),
        'GET https://api.github.com/user/installations/55501/repositories?per_page=100': () => json(RECORDED_PAGE),
    });
    const gh = githubClient(app, fetchFn);
    expect((await gh.repositoryById('ghu_x', '812345678'))?.fullName).toBe('heig-isc/intro-exercise');
    expect(await gh.repositoryByName('ghu_x', 'heig-isc/gone')).toBeNull();
    expect((await gh.installations('ghu_x')).length).toBe(2);
    expect((await gh.installationRepositories('ghu_x', 55501)).total).toBe(2);
    for (const a of asked) {
        expect(a.headers.get('authorization')).toBe('Bearer ghu_x');
        expect(a.headers.get('user-agent')).not.toBeNull();
    }
    // A name or id that is not one is not sent at all.
    expect(await gh.repositoryByName('ghu_x', '../user')).toBeNull();
    expect(await gh.repositoryById('ghu_x', '1/../2')).toBeNull();
    expect(asked.length).toBe(4);
});

test("GitHub's refusals become errors that say what GitHub said, a rate limit with when it ends, and never contain the token", async () => {
    const { fetchFn } = fakeFetch({
        'GET https://api.github.com/user/installations?per_page=100': () =>
            json({ message: 'API rate limit exceeded' }, 403, { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(Date.UTC(2026, 10, 18, 13) / 1000) }),
        'GET https://api.github.com/repositories/1': () => json({ message: 'Bad credentials' }, 401),
        'POST https://github.com/login/oauth/access_token': () => json({ error: 'bad_verification_code', error_description: 'The code passed is incorrect or expired.' }),
    });
    const gh = githubClient(app, fetchFn);
    const installations = await gh.installations('ghu_secret').catch((e: unknown) => e);
    expect(installations).toBeInstanceOf(GitHubError);
    expect(String(installations)).toContain('API rate limit exceeded (rate limited until 2026-11-18T13:00:00.000Z)');
    const byId = await gh.repositoryById('ghu_secret', '1').catch((e: unknown) => e);
    expect(byId).toMatchObject({ status: 401 });
    expect(String(byId)).not.toContain('ghu_secret');
    await expect(gh.exchangeCode('c0de')).rejects.toThrow('GitHub refused the code: The code passed is incorrect or expired.');
    const down = githubClient(app, () => Promise.reject(new Error('network down')));
    await expect(down.installations('ghu_secret')).rejects.toMatchObject({ status: 0 });
});

test('the code exchange and the revocation authenticate as the App, with its client secret, and a token already gone is revoked', async () => {
    const { fetchFn, asked } = fakeFetch({
        'POST https://github.com/login/oauth/access_token': () => json({ access_token: 'ghu_new', token_type: 'bearer' }),
        'DELETE https://api.github.com/applications/Iv1.abc/token': () => new Response(null, { status: 404 }),
    });
    const gh = githubClient(app, fetchFn);
    expect(await gh.exchangeCode('c0de')).toBe('ghu_new');
    expect(JSON.parse(asked[0]?.body ?? '')).toEqual({ client_id: 'Iv1.abc', client_secret: 'shh', code: 'c0de' });
    await gh.revokeToken('ghu_new');
    expect(asked[1]?.headers.get('authorization')).toBe(`Basic ${btoa('Iv1.abc:shh')}`);
    expect(JSON.parse(asked[1]?.body ?? '')).toEqual({ access_token: 'ghu_new' });
});

/** A GitHub that answers from fixed data and counts every call. */
function stubGitHub(over: Partial<GitHub> = {}): GitHub & { calls: string[] } {
    const calls: string[] = [];
    const base: GitHub = {
        exchangeCode: () => Promise.resolve('ghu_new'),
        installations: () => Promise.resolve([]),
        installationRepositories: () => Promise.resolve({ repositories: [], total: 0 }),
        repositoryById: () => Promise.resolve(null),
        repositoryByName: () => Promise.resolve(null),
        revokeToken: () => Promise.resolve(),
        ...over,
    };
    return {
        calls,
        exchangeCode: code => (calls.push('exchangeCode'), base.exchangeCode(code)),
        installations: token => (calls.push('installations'), base.installations(token)),
        installationRepositories: (token, id) => (calls.push('installationRepositories'), base.installationRepositories(token, id)),
        repositoryById: (token, id) => (calls.push('repositoryById'), base.repositoryById(token, id)),
        repositoryByName: (token, name) => (calls.push('repositoryByName'), base.repositoryByName(token, name)),
        revokeToken: token => (calls.push('revokeToken'), base.revokeToken(token)),
    };
}

test('the picker lists only repositories the person administers or maintains, from at most ten installations, and says when the list is not whole', async () => {
    const many = Array.from({ length: MAX_INSTALLATIONS + 2 }, (_, i) => ({ id: i + 1, account: `acct${i + 1}` }));
    const gh = stubGitHub({
        installations: () => Promise.resolve(many),
        installationRepositories: (_t, id) =>
            Promise.resolve({
                repositories: [repo({ id: `${id}0`, fullName: `acct${id}/b`, admin: true }), repo({ id: `${id}1`, fullName: `acct${id}/a`, admin: false, maintain: false })],
                total: 2,
            }),
    });
    const picker = await pickerFor(gh, 'ghu_x');
    expect(gh.calls.filter(c => c === 'installationRepositories').length).toBe(MAX_INSTALLATIONS);
    expect(picker.repositories.length).toBe(MAX_INSTALLATIONS);
    expect(picker.repositories.every(r => r.fullName.endsWith('/b'))).toBe(true);
    expect(picker.truncated).toBe(true);
    expect(picker.failed).toBeNull();

    const one = await pickerFor(
        stubGitHub({ installations: () => Promise.resolve([{ id: 1, account: 'a' }]), installationRepositories: () => Promise.resolve({ repositories: [repo()], total: 300 }) }),
        't',
    );
    expect(one.truncated).toBe(true);
});

test('an App installed on a whole organisation lists, to each person, only the repositories they administer or maintain there themselves', async () => {
    // What GitHub answers `/user/installations/{id}/repositories` for one
    // member of an organisation whose installation covers every repository:
    // only what that member may access, each with the member's own
    // permissions, and here one entry without permissions at all.
    const orgWide = repositoryPageOf({
        total_count: 4,
        repository_selection: 'all',
        repositories: [
            { ...RECORDED_REPOSITORY, id: 1, full_name: 'heig-isc/maintained', permissions: { admin: false, maintain: true, push: true, pull: true } },
            { ...RECORDED_REPOSITORY, id: 2, full_name: 'heig-isc/administered', permissions: { admin: true, maintain: true, push: true, pull: true } },
            { ...RECORDED_REPOSITORY, id: 3, full_name: 'heig-isc/pushed-to', permissions: { admin: false, maintain: false, push: true, pull: true } },
            { ...RECORDED_REPOSITORY, id: 4, full_name: 'heig-isc/read-only', permissions: { admin: false, maintain: false, push: false, pull: true } },
            { ...RECORDED_REPOSITORY, id: 5, full_name: 'heig-isc/no-permissions-said', permissions: undefined },
        ],
    });
    if (orgWide === null) throw new Error('the recorded page did not read');
    const gh = stubGitHub({ installations: () => Promise.resolve([{ id: 55501, account: 'heig-isc' }]), installationRepositories: () => Promise.resolve(orgWide) });
    expect((await pickerFor(gh, 'ghu_member')).repositories.map(r => r.fullName)).toEqual(['heig-isc/administered', 'heig-isc/maintained']);

    // A member of the edition's staff with no access to anything there yet,
    // or none any more: GitHub lists nothing, and so does the picker.
    const nobody = stubGitHub({ installations: () => Promise.resolve([{ id: 55501, account: 'heig-isc' }]), installationRepositories: () => Promise.resolve({ repositories: [], total: 0 }) });
    expect(await pickerFor(nobody, 'ghu_newcomer')).toEqual({ repositories: [], truncated: false, failed: null });
});

test('GitHub failing or rate limiting the picker is a sentence on the page, not a failed page', async () => {
    const picker = await pickerFor(
        stubGitHub({ installations: () => Promise.reject(new GitHubError('GitHub answered 403 to the list of installations (rate limited)', 403)) }),
        't',
    );
    expect(picker).toEqual({ repositories: [], truncated: false, failed: 'GitHub did not answer; Refresh, or Connect GitHub again.' });
});

const ME = '6f1c1c6e-0000-4000-8000-000000000001';
const SOMEBODY = '6f1c1c6e-0000-4000-8000-000000000002';
const now = new Date('2026-11-18T12:00:00Z');
const flight = {
    state: 'c3RhdGUtb2YtdGhlLWJyb3dzZXI',
    sub: ME,
    edition: '11111111-1111-4111-8111-111111111111' as EditionId,
    project: '22222222-2222-4222-8222-222222222222' as ProjectId,
    relink: false,
};
/** What GitHub sends back after an installation with user authorisation on. */
const installShaped = (state: string) => new URLSearchParams({ code: 'c0de', installation_id: '55501', setup_action: 'install', state });

test('a return from GitHub with no connection in flight in this browser says the App is installed, sets nothing and asks GitHub nothing', async () => {
    const gh = stubGitHub();
    const key = await cookieKey('shh');
    expect(await returned({ query: installShaped(flight.state), stateCookie: undefined, sub: ME, key, github: gh, now })).toEqual({ kind: 'installed' });
    expect(gh.calls).toEqual([]);
});

test('a return to a connection another person started in this browser is refused before GitHub is asked anything', async () => {
    const gh = stubGitHub();
    const key = await cookieKey('shh');
    const theirs = await sealState({ ...flight, sub: SOMEBODY }, key, now);
    expect(await returned({ query: installShaped(flight.state), stateCookie: theirs, sub: ME, key, github: gh, now })).toMatchObject({ kind: 'refused', status: 400 });
    expect(gh.calls).toEqual([]);
});

test("a return whose state is not this browser's, or after the connection expired, or signed out, is refused and asks GitHub nothing", async () => {
    const gh = stubGitHub();
    const key = await cookieKey('shh');
    const mine = await sealState(flight, key, now);
    for (const [why, input] of [
        ['another state', { query: installShaped('Z3Vlc3NlZC1ieS1hLXNpYmxpbmc'), stateCookie: mine, sub: ME }],
        ['no state', { query: new URLSearchParams({ code: 'c0de' }), stateCookie: mine, sub: ME }],
        ['signed out', { query: installShaped(flight.state), stateCookie: mine, sub: null }],
        ['sealed under another secret', { query: installShaped(flight.state), stateCookie: await sealState(flight, await cookieKey('old'), now), sub: ME }],
    ] as const) {
        expect((await returned({ ...input, key, github: gh, now })).kind, why).toBe('refused');
    }
    expect((await returned({ query: installShaped(flight.state), stateCookie: mine, sub: ME, key, github: gh, now: new Date(now.getTime() + 11 * 60_000) })).kind).toBe('refused');
    expect(gh.calls).toEqual([]);
});

test('a return to this browser’s own connection trades the code for a token sealed for this person, and goes back to the project page, to the picker when a link was being changed', async () => {
    const gh = stubGitHub();
    const key = await cookieKey('shh');
    const decided = await returned({ query: installShaped(flight.state), stateCookie: await sealState(flight, key, now), sub: ME, key, github: gh, now });
    expect(gh.calls).toEqual(['exchangeCode']);
    if (decided.kind !== 'connected') throw new Error(`not connected: ${JSON.stringify(decided)}`);
    expect(decided.to).toBe(`/editions/${flight.edition}/projects/${flight.project}?tab=releases`);
    expect(await openToken(decided.cookie, ME, key, now)).toBe('ghu_new');
    expect(await openToken(decided.cookie, SOMEBODY, key, now)).toBeNull();
    // Connect pressed while changing a link comes back to the picker, not to the old link.
    const changing = await returned({ query: installShaped(flight.state), stateCookie: await sealState({ ...flight, relink: true }, key, now), sub: ME, key, github: gh, now });
    if (changing.kind !== 'connected') throw new Error(`not connected: ${JSON.stringify(changing)}`);
    expect(changing.to).toBe(`/editions/${flight.edition}/projects/${flight.project}?tab=releases&relink#repository`);
});

test('a person who says no on GitHub, or a code GitHub refuses, ends the connection with a sentence', async () => {
    const key = await cookieKey('shh');
    const mine = await sealState(flight, key, now);
    const denied = await returned({
        query: new URLSearchParams({ error: 'access_denied', error_description: 'The user has denied your application access.', state: flight.state }),
        stateCookie: mine,
        sub: ME,
        key,
        github: stubGitHub(),
        now,
    });
    expect(denied).toMatchObject({ kind: 'failed', status: 400 });
    const refused = await returned({
        query: installShaped(flight.state),
        stateCookie: mine,
        sub: ME,
        key,
        github: stubGitHub({ exchangeCode: () => Promise.reject(new GitHubError('GitHub refused the code: expired', 200)) }),
        now,
    });
    expect(refused).toMatchObject({ kind: 'failed', status: 502 });
});
