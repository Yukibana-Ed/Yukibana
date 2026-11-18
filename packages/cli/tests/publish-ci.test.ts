import { afterEach, test, vi } from 'vitest';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { memoryStore, readArchive } from '@yukibana/client';
import { Failure, type Invocation, type Options } from '../src/commands/common.js';
import { release } from '../src/commands/release.js';

afterEach(() => vi.restoreAllMocks());

const CONFIG_PROJECT = '01a0b563-aeff-7c42-ae73-5aab2f2b5a01';
const LINKED = ['01a0b563-aeff-7c42-ae73-5aab2f2b5a02', '01a0b563-aeff-7c42-ae73-5aab2f2b5a03'];
const SHA = 'a'.repeat(40);
const REQUEST_URL = 'https://pipelines.actions.githubusercontent.com/abc/idtoken?api-version=2.0';
const CI_ENV = { ACTIONS_ID_TOKEN_REQUEST_URL: REQUEST_URL, ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'request-secret' };

/** A course directory whose yukibana.json names a project, as a template's may. */
async function course(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), 'yukibana-course-'));
    await writeFile(join(dir, 'yukibana.json'), JSON.stringify({ version: 1, kind: 'scala-sbt', projectId: CONFIG_PROJECT }));
    await writeFile(join(dir, 'build.sbt'), 'scalaVersion := "3.7.0"');
    await writeFile(join(dir, 'Main.scala'), 'object Main');
    return dir;
}

interface Seen {
    readonly audiences: string[];
    readonly requests: Request[];
}

/** A fetch standing in for GitHub's token service and the registry, which lists `projects` for the job. */
function world(
    projects: { id: string; slug: string; refused: string | null }[],
    publish: (project: string) => Response = () => published(),
): { seen: Seen; fetchFn: typeof fetch } {
    const seen: Seen = { audiences: [], requests: [] };
    let minted = 0;
    const fetchFn: typeof fetch = async (input, init) => {
        const req = new Request(input, init);
        const url = new URL(req.url);
        if (url.host === 'pipelines.actions.githubusercontent.com') {
            seen.audiences.push(url.searchParams.get('audience') ?? '');
            minted += 1;
            return Response.json({ value: `header.token${minted}.signature` });
        }
        seen.requests.push(req);
        if (url.pathname === '/api/ci/projects')
            return Response.json({
                repository: 'ada/course',
                ref: 'refs/tags/v1',
                sha: SHA,
                moved: null,
                projects: projects.map(p => ({ ...p, title: p.slug, edition: 'Intro, 2026 autumn' })),
            });
        const project = /^\/api\/projects\/([^/]+)\/releases$/.exec(url.pathname)?.[1];
        if (project !== undefined && req.method === 'POST') return publish(project);
        return Response.json({ message: 'no such route' }, { status: 404 });
    };
    return { seen, fetchFn };
}
const published = () => Response.json({ releaseId: 'r', starter: { size: 1, sha256: 'a' }, teacher: { size: 1, sha256: 'b' } }, { status: 201 });

/** Runs `publish` in `dir` with `options`, `env` and `fetchFn`, and returns what it printed. */
async function publishIn(dir: string, options: Options, env: NodeJS.ProcessEnv, fetchFn: typeof fetch): Promise<{ out: string[]; err: string[] }> {
    const out: string[] = [];
    const err: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((line: string) => void out.push(line));
    vi.spyOn(console, 'error').mockImplementation((line: string) => void err.push(line));
    const inv: Invocation = { options: { folder: 'course', ...options }, args: [dir], env, store: memoryStore(), fetch: fetchFn };
    await release('publish', inv);
    return { out, err };
}

/** The project id in the starter of a published form. */
async function starterProject(form: FormData): Promise<unknown> {
    const starter = form.get('starter');
    assert.ok(starter instanceof File);
    const entries = await readArchive(new Uint8Array(await starter.arrayBuffer()));
    const config = entries.find(e => e.path === 'course/yukibana.json');
    assert.ok(config !== undefined, entries.map(e => e.path).join(', '));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(config.data));
    return typeof parsed === 'object' && parsed !== null && 'projectId' in parsed ? parsed.projectId : undefined;
}

test('a registry URL with a trailing slash asks GitHub for a token for its origin', async () => {
    const { seen, fetchFn } = world([{ id: LINKED[0] ?? '', slug: 'a', refused: null }]);
    await publishIn(await course(), { ci: true, url: 'https://cloud.yukibana.dev/' }, CI_ENV, fetchFn);
    assert.equal(seen.audiences.length, seen.requests.length, 'a fresh token for every request to the registry');
    assert.equal(seen.requests.length, 2);
    assert.deepEqual(new Set(seen.audiences), new Set(['https://cloud.yukibana.dev']));
});

test("a yukibana.json naming a project still fans out under --ci, to every linked project, with each one's own id in its starter", async () => {
    const { seen, fetchFn } = world(LINKED.map((id, i) => ({ id, slug: `p${i}`, refused: null })));
    const { out, err } = await publishIn(await course(), { ci: true, url: 'https://cloud.yukibana.dev', label: 'v1' }, { ...CI_ENV, YUKIBANA_PROJECT: '' }, fetchFn);
    assert.ok(
        err.some(l => /projectId in yukibana\.json .* is ignored/.test(l)),
        err.join('\n'),
    );
    const posts = seen.requests.filter(r => r.method === 'POST');
    assert.deepEqual(
        posts.map(r => new URL(r.url).pathname),
        LINKED.map(id => `/api/projects/${id}/releases`),
    );
    const forms = await Promise.all(posts.map(p => p.formData()));
    for (const [i, post] of posts.entries()) {
        assert.equal(post.headers.get('authorization')?.startsWith('Bearer header.token'), true);
        const form = forms[i];
        assert.ok(form !== undefined);
        assert.equal(form.get('commit'), SHA, "the token's commit, the only one the registry takes");
        assert.equal(form.get('label'), 'v1');
        assert.equal(await starterProject(form), LINKED[i]);
    }
    assert.notEqual(forms[0]?.get('release'), forms[1]?.get('release'), 'a fresh release id per project');
    assert.ok(out.some(l => /linked to 2 projects/.test(l)));
    assert.ok(!out.concat(err).some(l => l.includes('header.token') || l.includes('request-secret')), 'no token is printed');
});

test('--ci with --token is refused before anything is built or sent', async () => {
    const { seen, fetchFn } = world([]);
    await assert.rejects(
        publishIn(await course(), { ci: true, token: 'yk_x', url: 'https://cloud.yukibana.dev' }, CI_ENV, fetchFn),
        (e: unknown) => e instanceof Failure && /drop --token/.test(e.message),
    );
    assert.deepEqual(seen.audiences, []);
    assert.deepEqual(seen.requests, []);
});

test('--ci with --project is refused too', async () => {
    const { seen, fetchFn } = world([]);
    await assert.rejects(publishIn(await course(), { ci: true, project: CONFIG_PROJECT, url: 'https://cloud.yukibana.dev' }, CI_ENV, fetchFn), /drop --project/);
    assert.deepEqual(seen.requests, []);
});

test('a failure for one project does not stop the others, and the job fails naming it and every skipped one', async () => {
    const { seen, fetchFn } = world(
        [
            { id: LINKED[0] ?? '', slug: 'broken', refused: null },
            { id: LINKED[1] ?? '', slug: 'fine', refused: null },
            { id: CONFIG_PROJECT, slug: 'orphan', refused: 'The person who linked this repository is no longer an owner of this edition; an owner must link it again.' },
        ],
        project => (project === LINKED[0] ? Response.json({ message: 'starter too large' }, { status: 413 }) : published()),
    );
    await assert.rejects(publishIn(await course(), { ci: true, url: 'https://cloud.yukibana.dev' }, CI_ENV, fetchFn), (e: unknown) => {
        assert.ok(e instanceof Failure);
        assert.equal(e.lines.length, 2, e.message);
        assert.match(e.message, /not published to orphan .*no longer an owner/);
        assert.match(e.message, /not published to broken .*413: starter too large/);
        return true;
    });
    assert.equal(seen.requests.filter(r => r.method === 'POST').length, 2, 'the skipped project is never sent anything');
});

test('a repository linked to nothing fails, pointing at the project page', async () => {
    const { fetchFn } = world([]);
    await assert.rejects(publishIn(await course(), { ci: true, url: 'https://cloud.yukibana.dev' }, CI_ENV, fetchFn), /linked to no project.*project page/);
});

test('a job without id-token permission is told to add it, and the registry is sent nothing', async () => {
    const { seen, fetchFn } = world([]);
    await assert.rejects(publishIn(await course(), { ci: true, url: 'https://cloud.yukibana.dev' }, {}, fetchFn), /permissions: id-token: write/);
    assert.deepEqual(seen.requests, []);
});

test('--ci is only for publish', async () => {
    const inv: Invocation = { options: { ci: true, folder: 'course' }, args: [await course()], env: {}, store: memoryStore() };
    await assert.rejects(release('check', inv), /--ci is only for publish/);
});

test('a publish with a project token is unchanged: one project, the token as the bearer, no GitHub', async () => {
    const { seen, fetchFn } = world([]);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await publishIn(await course(), { url: 'https://cloud.yukibana.dev' }, { ...CI_ENV, YUKIBANA_TOKEN: 'yk_secret' }, fetchFn);
    assert.deepEqual(seen.audiences, []);
    assert.deepEqual(
        seen.requests.map(r => [r.method, new URL(r.url).pathname, r.headers.get('authorization')]),
        [['POST', `/api/projects/${CONFIG_PROJECT}/releases`, 'Bearer yk_secret']],
    );
});
