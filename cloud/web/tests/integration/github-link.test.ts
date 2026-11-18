import { test, expect, afterAll, beforeAll } from 'vitest';
import { asUser, connect } from '../../src/lib/server/db.js';
import { linkOf, linkRepository, unlinkRepository } from '../../src/lib/server/github-link.js';
import type { GitHub, Repository } from '../../src/lib/server/github.js';
import { trustId, type ProjectId } from '../../src/lib/ids.js';
import { ALICE, ASSISTANT, TEACHER, claimsOf, config } from './env.js';

// Linking a project to a repository, as the project page's action does it,
// against the real database, with a GitHub stubbed here: GitHub is never
// asked. GitHub establishes who administers what; the database decides who
// may link which project.

const sql = connect(config.databaseUrl);
const run = Date.now();
let project: ProjectId;

const repo = (over: Partial<Repository> = {}): Repository => ({
    id: String(run),
    ownerId: String(run + 1),
    fullName: 'heig-isc/intro-exercise',
    private: true,
    admin: true,
    maintain: false,
    ...over,
});

/** A GitHub that knows one repository, by id and by name, and records what it is asked. */
function gitHubWith(known: Repository | null): GitHub & { asked: string[] } {
    const asked: string[] = [];
    const none = () => Promise.reject(new Error('not used here'));
    return {
        asked,
        exchangeCode: none,
        installations: none,
        installationRepositories: none,
        revokeToken: none,
        repositoryById: (_token, id) => (asked.push(`id ${id}`), Promise.resolve(known?.id === id ? known : null)),
        repositoryByName: (_token, name) => (asked.push(`name ${name}`), Promise.resolve(known?.fullName === name ? known : null)),
    };
}

const linkRow = async (): Promise<{ repository_id: string; owner_id: string; repository: string } | undefined> =>
    (
        await asUser(
            sql,
            claimsOf(TEACHER),
            tx => tx<{ repository_id: string; owner_id: string; repository: string }[]>`
      select repository_id, owner_id, repository from repository_link where project_id = ${project}`,
        )
    )[0];

beforeAll(async () => {
    project = await asUser(sql, claimsOf(TEACHER), async tx => {
        const [row] = await tx<{ project_id: string }[]>`
      insert into project (edition_id, slug, title, kind)
      select edition_id, ${`link-${run}`}, 'Linked', 'rust-cargo' from project where slug = 'warmup'
      returning project_id`;
        if (row === undefined) throw new Error('no seeded project "warmup"');
        return trustId<ProjectId>(row.project_id);
    });
});

afterAll(async () => {
    await sql.end({ timeout: 5 });
});

test('a repository GitHub does not show the person, or one they only push to, is refused before the database is asked', async () => {
    expect(await linkRepository(sql, claimsOf(TEACHER), project, gitHubWith(null), 'ghu_x', { name: 'heig-isc/intro-exercise' })).toMatchObject({ ok: false, status: 404 });
    const pusher = gitHubWith(repo({ admin: false, maintain: false }));
    const refused = await linkRepository(sql, claimsOf(TEACHER), project, pusher, 'ghu_x', { id: String(run) });
    expect(refused).toMatchObject({ ok: false, status: 403, message: expect.stringContaining('admin or maintain') });
    expect(await linkRow()).toBeUndefined();
});

test('an assistant or a student who administers the repository on GitHub still cannot link it: the database says who may', async () => {
    for (const who of [ASSISTANT, ALICE]) {
        const result = await linkRepository(sql, claimsOf(who), project, gitHubWith(repo()), 'ghu_x', { id: String(run) });
        expect(result, who).toMatchObject({ ok: false, status: 403 });
    }
    expect(await linkRow()).toBeUndefined();
});

test('an owner links the repository by the ids GitHub gives, whatever name they typed, and staff see the link while students do not', async () => {
    const gh = gitHubWith(repo());
    expect(await linkRepository(sql, claimsOf(TEACHER), project, gh, 'ghu_x', { name: 'heig-isc/intro-exercise' })).toEqual({ ok: true, repository: 'heig-isc/intro-exercise' });
    expect(gh.asked).toEqual(['name heig-isc/intro-exercise']);
    expect(await linkRow()).toEqual({ repository_id: String(run), owner_id: String(run + 1), repository: 'heig-isc/intro-exercise' });

    const seen = await asUser(sql, claimsOf(ASSISTANT), tx => linkOf(tx, project));
    expect(seen).toMatchObject({ repository: 'heig-isc/intro-exercise', ownerCurrent: true, lastPublish: null });
    expect(await asUser(sql, claimsOf(ALICE), tx => linkOf(tx, project))).toBeNull();
});

test('linking again replaces the link, and an assistant cannot unlink it while an owner can', async () => {
    const moved = repo({ id: String(run + 5), fullName: 'heig-isc/renamed', maintain: true, admin: false });
    expect(await linkRepository(sql, claimsOf(TEACHER), project, gitHubWith(moved), 'ghu_x', { id: String(run + 5) })).toMatchObject({ ok: true });
    expect((await linkRow())?.repository).toBe('heig-isc/renamed');

    await expect(unlinkRepository(sql, claimsOf(ASSISTANT), project)).rejects.toMatchObject({ code: '42501' });
    expect(await linkRow()).toBeDefined();
    await unlinkRepository(sql, claimsOf(TEACHER), project);
    expect(await linkRow()).toBeUndefined();
    await expect(unlinkRepository(sql, claimsOf(TEACHER), project)).rejects.toMatchObject({ code: 'P0002' });
});
