import { test, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { RegistryError, YukibanaClient } from '@yukibana/client';
import { asUser, connect } from '../../src/lib/server/db.js';
import { GITHUB_ACTIONS_ISSUER } from '../../src/lib/server/oidc.js';
import { trustId, type ProjectId } from '../../src/lib/ids.js';
import { TEACHER, claimsOf, config } from './env.js';
import { startApp, type App } from './app.js';

// A linked repository's job publishing over HTTP, as the Action does: the
// real app, a valid OIDC token, and the client library the CLI is built on.
// ci.test.ts drives the server modules with an injected key set; this is
// the whole path between them (the hook's routing of a CI bearer, the
// forgery check, the routes, multipart, the wire format), with GitHub's key
// set answered by a stand-in preloaded into the app (github-keys.ts).

const sql = connect(config.databaseUrl);
let app: App | undefined;
const archive = new Uint8Array(readFileSync(createRequire(import.meta.url).resolve('@yukibana/fixtures/repo.tar.gz')));
const SHA = 'feedface' + '0'.repeat(24) + 'feedface';
const run = Date.now();
const REPOSITORY_ID = String(run + 10);
const OWNER_ID = String(run + 11);
let sign: (over?: Record<string, unknown>, key?: 'ours' | 'stranger') => Promise<string>;
let first: ProjectId, second: ProjectId;

async function newProject(slug: string): Promise<ProjectId> {
    return asUser(sql, claimsOf(TEACHER), async tx => {
        const [row] = await tx<{ project_id: string }[]>`
      insert into project (edition_id, slug, title, kind)
      select edition_id, ${`${slug}-${run}`}, ${`HTTP ${slug}`}, 'rust-cargo' from project where slug = 'warmup'
      returning project_id`;
        if (row === undefined) throw new Error('no seeded project "warmup"');
        return trustId<ProjectId>(row.project_id);
    });
}

const releasesOf = async (project: ProjectId): Promise<{ from: string | null; commit_sha: string; label: string }[]> =>
    asUser(
        sql,
        claimsOf(TEACHER),
        tx => tx<{ from: string | null; commit_sha: string; label: string }[]>`
      select published_from as from, commit_sha, label from project_release where project_id = ${project} order by seq`,
    );

beforeAll(async () => {
    const ours = await generateKeyPair('RS256');
    const stranger = await generateKeyPair('RS256');
    const jwks = JSON.stringify({ keys: [{ ...(await exportJWK(ours.publicKey)), kid: 'ours', alg: 'RS256', use: 'sig' }] });
    const preload = fileURLToPath(new URL('./github-keys.ts', import.meta.url));
    app = await startApp(90_000, { NODE_OPTIONS: `${process.env['NODE_OPTIONS'] ?? ''} --import ${preload}`.trim(), YUKIBANA_TEST_GITHUB_JWKS: jwks });
    const origin = app.origin;
    sign = async (over = {}, key = 'ours') =>
        new SignJWT({
            repository_id: REPOSITORY_ID,
            repository_owner_id: OWNER_ID,
            repository: 'ada/http-course',
            ref: 'refs/tags/v1',
            sha: SHA,
            event_name: 'push',
            ...over,
        })
            .setProtectedHeader({ alg: 'RS256', kid: 'ours' })
            .setIssuer(GITHUB_ACTIONS_ISSUER)
            .setAudience(origin)
            .setIssuedAt()
            .setExpirationTime(Math.floor(Date.now() / 1000) + 300)
            .sign(key === 'ours' ? ours.privateKey : stranger.privateKey);
    [first, second] = [await newProject('http-a'), await newProject('http-b')];
    for (const p of [first, second]) await asUser(sql, claimsOf(TEACHER), tx => tx`select app.link_repository(${p}, ${REPOSITORY_ID}, ${OWNER_ID}, 'ada/http-course')`);
}, 120_000);

afterAll(async () => {
    await app?.stop();
    await sql.end({ timeout: 5 });
});

const clientWith = (token: string): YukibanaClient => new YukibanaClient({ url: app?.origin ?? '', accessToken: () => token });

test('a job of a linked repository lists, over HTTP, the projects it publishes to, and publishes a release to each of them', async () => {
    const answer = await clientWith(await sign()).ciProjects();
    expect(answer.repository).toBe('ada/http-course');
    expect(answer.sha).toBe(SHA);
    const mine = answer.projects.filter(p => p.id === first || p.id === second);
    expect(mine.map(p => p.refused)).toEqual([null, null]);

    for (const project of [first, second]) {
        const published = await clientWith(await sign()).publishRelease(project, archive, archive, 'v1', SHA, null);
        expect(published.starter.size).toBe(archive.byteLength);
        expect(await releasesOf(project)).toEqual([{ from: 'ada/http-course', commit_sha: SHA, label: 'v1' }]);
    }
});

test('over HTTP, a token signed by another key, or from a branch, publishes nothing', async () => {
    await expect(clientWith(await sign({}, 'stranger')).ciProjects()).rejects.toSatisfy((e: unknown) => e instanceof RegistryError && e.status === 401);
    await expect(clientWith(await sign({}, 'stranger')).publishRelease(first, archive, archive, 'forged', SHA, null)).rejects.toSatisfy(
        (e: unknown) => e instanceof RegistryError && e.status === 401,
    );
    await expect(clientWith(await sign({ ref: 'refs/heads/main' })).publishRelease(first, archive, archive, 'branch', SHA, null)).rejects.toSatisfy(
        (e: unknown) => e instanceof RegistryError && e.status === 403,
    );
    expect((await releasesOf(first)).map(r => r.label)).toEqual(['v1']);
});
