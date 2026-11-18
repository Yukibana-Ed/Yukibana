import { test } from 'vitest';
import assert from 'node:assert/strict';
import { NO_ID_TOKEN, OidcUnavailable, oidcRequestUrl, oidcTokenOf, requestOidcToken } from '../src/oidc.js';

const JWT = 'eyJhbGciOiJSUzI1NiJ9.eyJpc3MiOiJodHRwcyJ9.c2lnbmF0dXJl';
const REQUEST_URL = 'https://pipelines.actions.githubusercontent.com/abc/_apis/distributedtask/hubs/build/plans/1/jobs/2/idtoken?api-version=2.0';
const env = { ACTIONS_ID_TOKEN_REQUEST_URL: REQUEST_URL, ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'request-secret' };

/** A fetch that records each request and answers `answer`. */
const stub = (answer: () => Response) => {
    const seen: Request[] = [];
    const fetchFn: typeof fetch = async (url, init) => {
        seen.push(new Request(url, init));
        return answer();
    };
    return { seen, fetchFn };
};
const ok = () => new Response(JSON.stringify({ count: 1, value: JWT }), { status: 200, headers: { 'content-type': 'application/json' } });

test("a job asks GitHub for a token for the registry's origin, keeping GitHub's own query, with the request token as its bearer", async () => {
    const { seen, fetchFn } = stub(ok);
    assert.equal(await requestOidcToken(env, 'https://cloud.yukibana.dev', fetchFn), JWT);
    assert.equal(seen.length, 1);
    const url = new URL(seen[0]?.url ?? '');
    assert.equal(url.searchParams.get('api-version'), '2.0');
    assert.equal(url.searchParams.get('audience'), 'https://cloud.yukibana.dev');
    assert.equal(seen[0]?.method, 'GET');
    assert.equal(seen[0]?.headers.get('authorization'), 'bearer request-secret');
});

test('an audience is one query parameter, however it is spelled', () => {
    const url = new URL(oidcRequestUrl(`${REQUEST_URL}&audience=old`, 'https://x.dev/?a=b&audience=evil'));
    assert.deepEqual(url.searchParams.getAll('audience'), ['https://x.dev/?a=b&audience=evil']);
});

test.each<[string, Record<string, string>]>([
    ['neither variable', {}],
    ['no request token', { ACTIONS_ID_TOKEN_REQUEST_URL: REQUEST_URL }],
    ['no request URL', { ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'request-secret' }],
    ['empty variables', { ACTIONS_ID_TOKEN_REQUEST_URL: '', ACTIONS_ID_TOKEN_REQUEST_TOKEN: '' }],
])('a job without id-token permission (%s) is told to add it, and nothing is sent', async (_, given) => {
    const { seen, fetchFn } = stub(ok);
    await assert.rejects(requestOidcToken(given, 'https://cloud.yukibana.dev', fetchFn), (e: unknown) => e instanceof OidcUnavailable && e.message === NO_ID_TOKEN);
    assert.equal(seen.length, 0);
    assert.match(NO_ID_TOKEN, /permissions: id-token: write/);
});

test("GitHub's refusal is a sentence with its status, and never quotes the request token", async () => {
    const { fetchFn } = stub(() => new Response('{"message":"bad token request-secret"}', { status: 403 }));
    await assert.rejects(
        requestOidcToken(env, 'https://cloud.yukibana.dev', fetchFn),
        (e: unknown) => e instanceof OidcUnavailable && /refused the OIDC token request with 403/.test(e.message) && !e.message.includes('request-secret'),
    );
});

test.each<[string, unknown]>([
    ['no value', { count: 0 }],
    ['a value that is not a string', { value: 7 }],
    ['a value that is not a JWT', { value: 'request-secret' }],
    ['not an object', null],
])('an answer with %s is refused without being quoted', (_, body) => {
    assert.throws(
        () => oidcTokenOf(body),
        (e: unknown) => e instanceof OidcUnavailable && !e.message.includes('request-secret'),
    );
});

test('an answer that is not JSON is refused', async () => {
    const { fetchFn } = stub(() => new Response('<html>', { status: 200 }));
    await assert.rejects(requestOidcToken(env, 'https://cloud.yukibana.dev', fetchFn), /other than JSON/);
});

test('a request URL that is not a URL is refused before anything is sent', async () => {
    const { seen, fetchFn } = stub(ok);
    await assert.rejects(requestOidcToken({ ...env, ACTIONS_ID_TOKEN_REQUEST_URL: 'not a url' }, 'https://cloud.yukibana.dev', fetchFn), OidcUnavailable);
    assert.equal(seen.length, 0);
});
