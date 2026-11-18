import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MOVED, NOT_LINKED, OWNER_GONE, ciProjectsOf, ciRefusal, onlyTags, type CiLinkRow } from '../src/lib/server/ci.js';
import type { CiIdentity } from '../src/lib/server/oidc.js';

const identity: CiIdentity = { repositoryId: '42', ownerId: '7', repository: 'ada/course', ref: 'refs/tags/v1', sha: 'a'.repeat(40), event: 'push' };

const linked = (over: Partial<CiLinkRow> = {}): CiLinkRow => ({
    project_id: '01a0b47d-0000-7000-8000-000000000001',
    project_slug: 'warmup',
    project_title: 'Warm-up',
    edition_title: 'Introduction to Programming',
    edition_label: '2026 autumn',
    owner_matches: true,
    ref_matches: true,
    owner_current: true,
    ...over,
});
const moved: CiLinkRow = {
    project_id: null,
    project_slug: null,
    project_title: null,
    edition_title: null,
    edition_label: null,
    owner_matches: false,
    ref_matches: null,
    owner_current: null,
};

test('a link publishes only when the owner matches, the run is at a tag and its maker still owns the edition, and says which failed first', () => {
    const cases: [CiLinkRow, string | null][] = [
        [linked(), null],
        [linked({ ref_matches: false }), 'Only tags publish; this run is at refs/heads/main.'],
        [linked({ owner_current: false }), OWNER_GONE],
        [linked({ ref_matches: false, owner_current: false }), 'Only tags publish; this run is at refs/heads/main.'],
        [linked({ ref_matches: null, owner_current: null }), 'Only tags publish; this run is at refs/heads/main.'],
        [moved, MOVED],
    ];
    for (const [row, want] of cases) assert.equal(ciRefusal(row, 'refs/heads/main'), want, JSON.stringify(row));
});

test('a job is told every project it may publish to, why it skips the others, and of a moved repository only that it moved', () => {
    const answer = ciProjectsOf(identity, [linked(), linked({ project_id: 'p2', project_slug: 'second', owner_current: false, edition_label: '' }), moved]);
    assert.deepEqual(answer, {
        repository: 'ada/course',
        ref: 'refs/tags/v1',
        sha: 'a'.repeat(40),
        moved: MOVED,
        projects: [
            { id: '01a0b47d-0000-7000-8000-000000000001', slug: 'warmup', title: 'Warm-up', edition: 'Introduction to Programming, 2026 autumn', refused: null },
            { id: 'p2', slug: 'second', title: 'Warm-up', edition: 'Introduction to Programming', refused: OWNER_GONE },
        ],
    });
    const onlyMoved = ciProjectsOf(identity, [moved]);
    assert.deepEqual(onlyMoved.projects, []);
    assert.equal(onlyMoved.moved, MOVED);
    assert.deepEqual(ciProjectsOf(identity, []), { repository: 'ada/course', ref: 'refs/tags/v1', sha: 'a'.repeat(40), moved: null, projects: [] });
});

test("the Worker's sentences are the database's, so a job reads the same reason whichever refused it", () => {
    const migration = readFileSync(fileURLToPath(new URL('../../db/supabase/migrations/20261118090000_repository_links.sql', import.meta.url)), 'utf8');
    for (const sentence of [NOT_LINKED, MOVED, OWNER_GONE, onlyTags('%')]) assert.ok(migration.includes(`'${sentence.replaceAll("'", "''")}'`), sentence);
});

test("the feature's documentation quotes the sentences a job really reads, so a teacher can search the page for what the log says", () => {
    const page = readFileSync(fileURLToPath(new URL('../../../docs/cloud/github.md', import.meta.url)), 'utf8');
    for (const sentence of [MOVED, OWNER_GONE, onlyTags('refs/heads/main')]) assert.ok(page.includes(sentence), sentence);
});
