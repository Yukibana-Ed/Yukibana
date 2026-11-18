import { test, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWTVerifyGetKey } from 'jose';
import { asUser, connect } from '../../src/lib/server/db.js';
import { s3Bucket } from '../../src/lib/server/storage.js';
import { publishRelease } from '../../src/lib/server/releases.js';
import { releases as releasesListed } from '../../src/lib/server/catalogue.js';
import { ciLinks, ciProjectsOf, MOVED, NOT_LINKED } from '../../src/lib/server/ci.js';
import { GITHUB_ACTIONS_ISSUER, verifyCiToken, type CiIdentity } from '../../src/lib/server/oidc.js';
import { trustId, type ProjectId } from '../../src/lib/ids.js';
import type { Context } from '../../src/lib/server/context.js';
import { TEACHER, claimsOf, config } from './env.js';
import { startApp, type App } from './app.js';
import { signIn } from './browser.js';

// A CI job of a repository linked to projects publishes to them with
// GitHub's OIDC token instead of a secret. These drive the server modules
// against the local stack with a key set made here, standing in for
// GitHub's: tokens are signed locally, and GitHub is never asked. Over
// HTTP, where the app would fetch GitHub's real keys, only tokens refused
// before any key is needed are sent.

const sql = connect(config.databaseUrl);
const bucket = s3Bucket(config.s3);
const ctx: Context = { config, sql, bucket };
let app: App | undefined;

const archive = new Uint8Array(readFileSync(createRequire(import.meta.url).resolve('@yukibana/fixtures/repo.tar.gz')));
const other = new Uint8Array([...archive, 0]);

/** The registry's audience in the module tests: its canonical origin. */
const AUDIENCE = 'https://cloud.yukibana.test';
const SHA = 'c0ffee0000000000000000000000000000c0ffee';
// Fresh ids each run, so links left by an earlier run never answer for this one.
const run = Date.now();
const REPOSITORY_ID = String(run);
const OWNER_ID = String(run + 1);

let keys: JWTVerifyGetKey;
let sign: (claims: Record<string, unknown>, opts?: { aud?: string; iss?: string; exp?: number }) => Promise<string>;
/** Two projects linked to the repository, one not linked, and one linked to another repository. */
let first: ProjectId, second: ProjectId, unlinked: ProjectId, elsewhere: ProjectId;

const claims = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    repository_id: REPOSITORY_ID,
    repository_owner_id: OWNER_ID,
    repository: 'ada/course',
    ref: 'refs/tags/v1',
    sha: SHA,
    event_name: 'push',
    ...over,
});

async function newProject(slug: string): Promise<ProjectId> {
    return asUser(sql, claimsOf(TEACHER), async tx => {
        const [row] = await tx<{ project_id: string }[]>`
      insert into project (edition_id, slug, title, kind)
      select edition_id, ${`${slug}-${run}`}, ${`CI ${slug}`}, 'rust-cargo' from project where slug = 'warmup'
      returning project_id`;
        if (row === undefined) throw new Error('no seeded project "warmup"');
        return trustId<ProjectId>(row.project_id);
    });
}

const link = async (project: ProjectId, repositoryId: string): Promise<void> => {
    await asUser(sql, claimsOf(TEACHER), tx => tx`select app.link_repository(${project}, ${repositoryId}, ${OWNER_ID}, 'ada/course')`);
};

const releasesOf = async (project: ProjectId): Promise<number> => {
    const [row] = await asUser(sql, claimsOf(TEACHER), tx => tx<{ n: number }[]>`select count(*)::int as n from project_release where project_id = ${project}`);
    return row?.n ?? -1;
};

/** The identity a token signed with `over` verifies to, or the test fails with why not. */
async function identity(over: Record<string, unknown> = {}): Promise<CiIdentity> {
    const verified = await verifyCiToken(await sign(claims(over)), AUDIENCE, keys);
    if (typeof verified === 'string') throw new Error(`the token was refused: ${verified}`);
    return verified;
}

/** A context whose bucket records every object written to it. */
function recording(): { ctx: Context; put: string[] } {
    const put: string[] = [];
    return {
        put,
        ctx: {
            ...ctx,
            bucket: {
                ...bucket,
                put: async (key, body, type) => {
                    put.push(key);
                    await bucket.put(key, body, type);
                },
            },
        },
    };
}

const fingerprint = async (): Promise<unknown> => asUser(sql, claimsOf(TEACHER), async tx => (await tx<{ f: unknown }[]>`select tests.fingerprint() as f`)[0]?.f);

beforeAll(async () => {
    const { publicKey, privateKey } = await generateKeyPair('RS256');
    keys = createLocalJWKSet({ keys: [{ ...(await exportJWK(publicKey)), kid: 'local', alg: 'RS256' }] });
    sign = async (body, opts = {}) =>
        new SignJWT(body)
            .setProtectedHeader({ alg: 'RS256', kid: 'local' })
            .setIssuer(opts.iss ?? GITHUB_ACTIONS_ISSUER)
            .setAudience(opts.aud ?? AUDIENCE)
            .setIssuedAt()
            .setExpirationTime(opts.exp ?? Math.floor(Date.now() / 1000) + 300)
            .sign(privateKey);
    [first, second, unlinked, elsewhere] = [await newProject('ci-a'), await newProject('ci-b'), await newProject('ci-none'), await newProject('ci-other')];
    await link(first, REPOSITORY_ID);
    await link(second, REPOSITORY_ID);
    await link(elsewhere, String(run + 2));
});

afterAll(async () => {
    await app?.stop();
    await sql.end({ timeout: 5 });
});

test('a tag pushed in a linked repository publishes to every project linked to it, as the owner who linked it, from the commit the token names', async () => {
    const job = await identity();
    const listed = ciProjectsOf(job, await ciLinks(ctx, job));
    expect(listed.moved).toBeNull();
    expect(listed.projects.filter(p => p.id === first || p.id === second).map(p => p.refused)).toEqual([null, null]);
    expect(listed.projects.map(p => p.id)).not.toContain(elsewhere);

    for (const project of [first, second]) {
        const published = await publishRelease(ctx, { kind: 'ci', identity: job }, project, archive, other, 'v1', null, null);
        const [row] = await asUser(
            sql,
            claimsOf(TEACHER),
            tx => tx<{ by: string; from: string | null; commit_sha: string; label: string; via: boolean }[]>`
      select uploaded_by::text as by, published_from as from, commit_sha, label, token_id is not null as via
      from project_release where release_id = ${published.releaseId}`,
        );
        expect(row).toEqual({ by: claimsOf(TEACHER).sub, from: 'ada/course', commit_sha: SHA, label: 'v1', via: false });
    }
    // The CLI sends the commit too; the same one is accepted.
    await publishRelease(ctx, { kind: 'ci', identity: job }, first, archive, other, 'v1 again', SHA.toUpperCase(), null);
    // The API says where a release by link came from, as the project page does.
    const listed2 = await releasesListed(ctx, claimsOf(TEACHER), first);
    expect(listed2.map(r => r.publishedFrom)).toEqual(['ada/course', 'ada/course']);
});

test('a token for another registry, from another issuer, expired, or from a pull request is refused, and the refusal for the audience names the one expected', async () => {
    const now = Math.floor(Date.now() / 1000);
    expect(await verifyCiToken(await sign(claims(), { aud: 'https://other.example' }), AUDIENCE, keys)).toBe(
        `this token is for https://other.example; this registry expects ${AUDIENCE}`,
    );
    expect(await verifyCiToken(await sign(claims(), { iss: 'https://ghe.example.com/_services/token' }), AUDIENCE, keys)).toMatch(/accepts only https:\/\/token\.actions/);
    expect(await verifyCiToken(await sign(claims(), { exp: now - 5 }), AUDIENCE, keys)).toMatch(/expired/);
    expect(await verifyCiToken(await sign(claims({ event_name: 'pull_request' })), AUDIENCE, keys)).toMatch(/pull_request run does not publish/);
});

test('a branch, a project not linked to the repository, and a commit other than the token says are each refused before anything is stored', async () => {
    const cases: [string, CiIdentity, ProjectId, string | null, number, RegExp][] = [
        ['a branch', await identity({ ref: 'refs/heads/main' }), first, null, 403, /Only tags publish; this run is at refs\/heads\/main\./],
        ['an unlinked project', await identity(), unlinked, null, 403, new RegExp(NOT_LINKED.replace(/[.;]/g, '\\$&'))],
        ['a project linked to another repository', await identity(), elsewhere, null, 403, /not linked to that project/],
        ['another commit', await identity(), first, 'abc1234', 400, /not the one this job runs at/],
    ];
    for (const [what, job, project, commit, status, message] of cases) {
        const before = await releasesOf(project);
        const { ctx: watched, put } = recording();
        await expect(publishRelease(watched, { kind: 'ci', identity: job }, project, archive, other, 'nope', commit, null), what).rejects.toMatchObject({
            status,
            body: { message: expect.stringMatching(message) },
        });
        expect(put, what).toEqual([]);
        expect(await releasesOf(project), what).toBe(before);
    }
    // A moved repository's job is told that it moved, and of no project.
    const moved = await identity({ repository_owner_id: String(run + 99) });
    expect(ciProjectsOf(moved, await ciLinks(ctx, moved))).toMatchObject({ moved: MOVED, projects: [] });
});

test('a moved repository is told it moved only by a project it was linked to, and not linked by any other, and leaves nothing in the bucket either way', async () => {
    // The Worker cannot tell which project a moved link belongs to, so the database decides, after the upload, and
    // its refusal deletes both objects.
    const moved = await identity({ repository_owner_id: String(run + 99) });
    for (const [project, sentence] of [
        [first, MOVED],
        [unlinked, NOT_LINKED],
    ] as const) {
        const before = await releasesOf(project);
        const { ctx: watched, put } = recording();
        await expect(publishRelease(watched, { kind: 'ci', identity: moved }, project, archive, other, 'nope', null, null), sentence).rejects.toMatchObject({
            status: 403,
            body: { message: sentence },
        });
        for (const key of put) expect(await bucket.head(key as Parameters<typeof bucket.head>[0]), key).toBeNull();
        expect(await releasesOf(project), sentence).toBe(before);
    }
    // And a branch run is listed with the reason each project is skipped.
    const branch = await identity({ ref: 'refs/heads/main' });
    const skipped = ciProjectsOf(branch, await ciLinks(ctx, branch)).projects.map(p => p.refused);
    expect(skipped).toEqual(['Only tags publish; this run is at refs/heads/main.', 'Only tags publish; this run is at refs/heads/main.']);
});

test(
    'over HTTP, a CI token for another registry, an expired one and one from another issuer get the CI refusal from both CI routes, and a GitHub-looking bearer with a teacher’s cookies is nobody',
    { timeout: 180_000 },
    async () => {
        app = await startApp();
        const origin = app.origin;
        const teacher = await signIn(origin, TEACHER);
        const [ids] = await asUser(sql, claimsOf(TEACHER), tx => tx<{ edition_id: string }[]>`select edition_id from project where project_id = ${first}`);
        const edition = ids?.edition_id ?? '';
        const before = await fingerprint();
        const releases = await releasesOf(first);

        const foreign = await sign(claims(), { aud: 'https://other.example' });
        // The audience the app expects is its SITE_URL, which the suite sets to this server's origin (app.ts).
        // Its refusal names it, so a job can tell which to ask for.
        const told = (await (await fetch(`${origin}/api/ci/projects`, { headers: { authorization: `Bearer ${foreign}`, accept: 'application/json' } })).json()) as {
            message: string;
        };
        const expected = told.message.match(/this registry expects (\S+)\.$/)?.[1] ?? '';
        expect(expected, told.message).toBe(origin);
        const expired = await sign(claims(), { aud: expected, exp: Math.floor(Date.now() / 1000) - 5 });
        // A GitHub Enterprise job's token, from an issuer of its own: told which issuer is accepted, not to log in.
        const enterprise = await sign(claims(), { aud: expected, iss: 'https://school.ghe.com/_services/token' });
        const form = (): FormData => {
            const f = new FormData();
            f.set('starter', new File([archive], 'starter.tar.gz'));
            f.set('teacher', new File([other], 'teacher.tar.gz'));
            f.set('label', 'v1');
            return f;
        };
        const answers: string[] = [];
        for (const [token, why] of [
            [foreign, `this token is for https://other.example; this registry expects ${expected}.`],
            [expired, 'it expired at'],
            [enterprise, `it was issued by https://school.ghe.com/_services/token; this registry accepts only ${GITHUB_ACTIONS_ISSUER}.`],
        ] as const) {
            for (const [method, path] of [
                ['POST', `/api/projects/${first}/releases`],
                ['GET', '/api/ci/projects'],
            ] as const) {
                const r = await fetch(`${origin}${path}`, {
                    method,
                    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
                    ...(method === 'POST' ? { body: form() } : {}),
                });
                const body = (await r.json()) as { message: string };
                answers.push(`${method} ${path}: ${r.status} ${body.message.startsWith(`CI token refused: ${why}`) ? 'refused as CI' : body.message}`);
            }
        }
        expect(answers).toEqual([
            `POST /api/projects/${first}/releases: 401 refused as CI`,
            'GET /api/ci/projects: 401 refused as CI',
            `POST /api/projects/${first}/releases: 401 refused as CI`,
            'GET /api/ci/projects: 401 refused as CI',
            `POST /api/projects/${first}/releases: 401 refused as CI`,
            'GET /api/ci/projects: 401 refused as CI',
        ]);
        // A person's session is not a CI token.
        const asPerson = await fetch(`${origin}/api/ci/projects`, { headers: { cookie: teacher, accept: 'application/json' } });
        expect(asPerson.status).toBe(401);

        // A bearer with GitHub's issuer, unsigned, with the teacher's cookies: forgery lets a bearer through, so the
        // session code must take it for nobody, not for the teacher.
        const fake = `${Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url')}.${Buffer.from(JSON.stringify({ iss: GITHUB_ACTIONS_ISSUER, ...claims() })).toString('base64url')}.sig`;
        const enrol = await fetch(`${origin}/api/editions/${edition}/members`, {
            method: 'POST',
            headers: { authorization: `Bearer ${fake}`, cookie: teacher, 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({ email: 'mallory@evil.example', role: 'owner' }),
        });
        expect(enrol.status, await enrol.text()).toBe(401);
        const action = await fetch(`${origin}/editions/${edition}/projects/${first}?/createToken`, {
            method: 'POST',
            redirect: 'manual',
            headers: {
                authorization: `Bearer ${fake}`,
                cookie: teacher,
                origin,
                'sec-fetch-site': 'same-origin',
                'content-type': 'application/x-www-form-urlencoded',
                accept: 'text/html',
            },
            body: new URLSearchParams({ label: 'owned' }),
        });
        await action.arrayBuffer();
        expect(action.status).toBe(303);
        expect(action.headers.get('location') ?? '').toMatch(/^\/auth\/login\?next=/);

        expect(await releasesOf(first)).toBe(releases);
        expect(await fingerprint()).toEqual(before);
        // The cookies were left alone: the teacher is still signed in.
        const me = await fetch(`${origin}/api/me`, { headers: { cookie: teacher, accept: 'application/json' } });
        expect(((await me.json()) as { email: string }).email).toBe(TEACHER);
    },
);
