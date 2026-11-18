import { test } from 'vitest';
import assert from 'node:assert/strict';
import { RegistryError, YukibanaClient } from '../src/client.js';

const TOKEN = `yk_${'a'.repeat(64)}`;
const PROJECT = '01a0b563-aeff-7c42-ae73-5aab2f2b5a5a';

/** Publishes two small archives through a client for `url` that sends with `fetchFn`. */
const publish = (fetchFn: typeof fetch, over: { url?: string; commit?: string; release?: string } = {}) =>
    new YukibanaClient({ url: over.url ?? 'https://cloud.yukibana.dev', accessToken: () => TOKEN, fetch: fetchFn }).publishRelease(
        PROJECT,
        new Uint8Array([1, 2, 3]),
        new Uint8Array([4, 5, 6, 7]),
        'v1',
        over.commit ?? null,
        over.release ?? null,
    );

/** Records the one request `publishRelease` makes and answers whatever it is told. */
const recorder = (answer: Response) => {
    const seen: { request?: Request } = {};
    const fetchFn: typeof fetch = async (url, init) => {
        seen.request = new Request(url, init);
        return answer.clone();
    };
    return { seen, fetchFn };
};

const accepted = () =>
    new Response(
        JSON.stringify({
            releaseId: '01a0b563-aeff-7c42-ae73-5aab2f2b5a5b',
            starter: { size: 3, sha256: 'aa' },
            teacher: { size: 4, sha256: 'bb' },
        }),
        { status: 201, headers: { 'content-type': 'application/json' } },
    );

test('a publish says where it is posting, or the registry refuses it as a forged form', async () => {
    // This was the bug: the CLI sent the multipart body with no `origin`, and
    // SvelteKit's cross-site check rejected it before the route ran — "403
    // Cross-site POST form submissions are forbidden" out of a CI job that had
    // built both archives correctly. A browser always sends the header; a
    // command line tool has to say so itself.
    const { seen, fetchFn } = recorder(accepted());
    await publish(fetchFn);
    assert.equal(seen.request?.headers.get('origin'), 'https://cloud.yukibana.dev');
});

test('the origin is the registry it is posting to, whatever path the teacher gave', async () => {
    const { seen, fetchFn } = recorder(accepted());
    await publish(fetchFn, { url: 'https://cloud.yukibana.dev/projects/abc/' });
    assert.equal(seen.request?.headers.get('origin'), 'https://cloud.yukibana.dev');
    assert.equal(seen.request?.url, 'https://cloud.yukibana.dev/api/projects/01a0b563-aeff-7c42-ae73-5aab2f2b5a5a/releases');
});

test('the token travels as a bearer, which is the only thing the endpoint accepts', async () => {
    const { seen, fetchFn } = recorder(accepted());
    await publish(fetchFn);
    assert.equal(seen.request?.method, 'POST');
    assert.equal(seen.request?.headers.get('authorization'), `Bearer yk_${'a'.repeat(64)}`);
});

test('both archives and the label go in one multipart body', async () => {
    const { seen, fetchFn } = recorder(accepted());
    await publish(fetchFn, { commit: 'deadbeef' });
    assert.ok(seen.request);
    const form = await seen.request.formData();
    const starter = form.get('starter');
    const teacher = form.get('teacher');
    assert.ok(starter instanceof File && teacher instanceof File);
    assert.deepEqual(new Uint8Array(await starter.arrayBuffer()), new Uint8Array([1, 2, 3]));
    assert.deepEqual(new Uint8Array(await teacher.arrayBuffer()), new Uint8Array([4, 5, 6, 7]));
    assert.equal(form.get('label'), 'v1');
    assert.equal(form.get('commit'), 'deadbeef');
});

test('a refusal reaches the teacher in the words the registry used, not as a status code', async () => {
    const { fetchFn } = recorder(new Response(JSON.stringify({ message: 'unknown or revoked token' }), { status: 401 }));
    await assert.rejects(publish(fetchFn), (e: unknown) => e instanceof RegistryError && e.status === 401 && /the registry answered 401: unknown or revoked token/.test(e.message));
});

test('the release id the starter carries goes with the upload, so the row gets the same one', async () => {
    const { seen, fetchFn } = recorder(accepted());
    await publish(fetchFn, { release: '01a0b563-aeff-7c42-ae73-5aab2f2b5a5c' });
    assert.equal((await seen.request?.formData())?.get('release'), '01a0b563-aeff-7c42-ae73-5aab2f2b5a5c');
    const none = recorder(accepted());
    await publish(none.fetchFn);
    assert.equal((await none.seen.request?.formData())?.get('release'), null, 'archives without an id send none');
});

test('a CI job asks which projects its repository publishes to with its OIDC token as the bearer, fresh for each request', async () => {
    const tokens = ['first.oidc.token', 'second.oidc.token'];
    const seen: Request[] = [];
    const answer = { repository: 'ada/course', ref: 'refs/tags/v1', sha: 'a'.repeat(40), moved: null, projects: [] };
    const fetchFn: typeof fetch = async (url, init) => {
        seen.push(new Request(url, init));
        return new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const client = new YukibanaClient({ url: 'https://cloud.yukibana.dev/', accessToken: () => tokens.shift() ?? 'none', fetch: fetchFn });
    assert.deepEqual(await client.ciProjects(), answer);
    await client.ciProjects();
    assert.equal(seen[0]?.method, 'GET');
    assert.equal(seen[0]?.url, 'https://cloud.yukibana.dev/api/ci/projects');
    assert.deepEqual(
        seen.map(r => r.headers.get('authorization')),
        ['Bearer first.oidc.token', 'Bearer second.oidc.token'],
    );
});

test("a CI job's refusal reaches the log in the registry's words, the audience it expected included", async () => {
    const { fetchFn } = recorder(
        new Response(JSON.stringify({ message: 'CI token refused: this token is for https://elsewhere.dev; this registry expects https://cloud.yukibana.dev' }), { status: 401 }),
    );
    const client = new YukibanaClient({ url: 'https://cloud.yukibana.dev', accessToken: () => 'x.y.z', fetch: fetchFn });
    await assert.rejects(
        client.ciProjects(),
        (e: unknown) => e instanceof RegistryError && e.status === 401 && /this registry expects https:\/\/cloud\.yukibana\.dev/.test(e.message),
    );
});
