import { test, expect } from 'vitest';
import { designOf, handInsOf, outdated, subtitle, tally, versionName, type EnrolledStudent, type HandIn } from '../src/lib/hand-ins';
import { trustId, type ReleaseId, type SubmissionId, type UserId } from '../src/lib/ids';

const user = (n: string) => trustId<UserId>(`00000000-0000-4000-8000-00000000000${n}`);
const student = (email: string, id: UserId | null, fullName: string | null = null): EnrolledStudent => ({ email, userId: id, fullName, githubLogin: null });
let next = 0;
const handIn = (author: UserId, at: string, late = false, base: HandIn['base'] = null): HandIn => ({
    submissionId: trustId<SubmissionId>(`s${(next += 1)}`),
    authorId: author,
    submittedAt: new Date(at),
    byteSize: 2048,
    sha256: '0'.repeat(64),
    late,
    base,
    fullName: null,
    githubLogin: null,
});
const release = (version: number, latest: boolean, label = ''): NonNullable<HandIn['base']> => ({ releaseId: trustId<ReleaseId>(`r${version}`), label, version, latest });

test('every enrolled student has a line, including those who have submitted nothing', () => {
    const lines = handInsOf([student('a@x', user('1'), 'Alice'), student('b@x', null)], []);
    expect(lines.map(l => [l.name, l.standing])).toEqual([
        ['Alice', 'missing'],
        ['b@x', 'missing'],
    ]);
});

test('a student is judged by their newest submission, and it is the one shown first', () => {
    const early = handIn(user('1'), '2026-11-01T10:00:00Z');
    const late = handIn(user('1'), '2026-11-08T10:00:00Z', true);
    const [line] = handInsOf([student('a@x', user('1'), 'Alice')], [early, late]);
    expect(line?.standing).toBe('late');
    expect(line?.latest).toBe(late);
    expect(line?.submissions).toEqual([late, early]);
});

test('the list puts who still owes work first, then late, then on time', () => {
    const lines = handInsOf(
        [student('a@x', user('1'), 'Ann'), student('b@x', user('2'), 'Ben'), student('c@x', user('3'), 'Cat')],
        [handIn(user('1'), '2026-11-01T10:00:00Z'), handIn(user('2'), '2026-11-01T10:00:00Z', true)],
    );
    expect(lines.map(l => l.name)).toEqual(['Cat', 'Ben', 'Ann']);
});

test('the work of somebody no longer enrolled stays on the list, marked as such', () => {
    const gone = { ...handIn(user('9'), '2026-11-01T10:00:00Z'), fullName: 'Gone Student' };
    const lines = handInsOf([], [gone]);
    expect(lines).toMatchObject([{ name: 'Gone Student', enrolled: false, email: null, standing: 'on-time' }]);
});

test('a submission built on an older starter is outdated; one that names no starter is not', () => {
    expect(outdated(handIn(user('1'), '2026-11-01T10:00:00Z', false, release(2, false)))).toBe(true);
    expect(outdated(handIn(user('1'), '2026-11-01T10:00:00Z', false, release(3, true)))).toBe(false);
    expect(outdated(handIn(user('1'), '2026-11-01T10:00:00Z'))).toBe(false);
});

test('a version is named by its number, with its label when it has one', () => {
    expect(versionName(release(2, false))).toBe('v2');
    expect(versionName(release(2, false, 'week 1'))).toBe('v2 (week 1)');
});

test('the summary counts students, by their newest submission', () => {
    const lines = handInsOf(
        [student('a@x', user('1')), student('b@x', user('2')), student('c@x', null)],
        [handIn(user('1'), '2026-11-01T10:00:00Z', false, release(1, false)), handIn(user('2'), '2026-11-01T10:00:00Z', true)],
    );
    expect(tally(lines)).toEqual({ missing: 1, late: 1, 'on-time': 1, outdated: 1 });
});

test('the page draws the design its address names, and the first for anything else', () => {
    expect(designOf(new URL('https://cloud.example/?design=split'))).toBe('split');
    expect(designOf(new URL('https://cloud.example/?design=nope'))).toBe('table');
});

test('the line under a name never repeats the name, and says when somebody has left', () => {
    const [unlinked] = handInsOf([student('j@x', null)], []);
    expect(unlinked !== undefined && subtitle(unlinked)).toBe('');
    const [gone] = handInsOf([], [{ ...handIn(user('9'), '2026-11-01T10:00:00Z'), githubLogin: 'gone' }]);
    expect(gone !== undefined && subtitle(gone)).toBe('@gone · no longer enrolled');
});
