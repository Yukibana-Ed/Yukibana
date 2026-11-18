import { test } from 'vitest';
import assert from 'node:assert/strict';
import type { CiProject, CiProjects } from '@yukibana/client';
import { ciPlanOf, NAMED_NOT_LINKED, NOTHING_LINKED, NOTHING_NAMED, publishModeOf, type PublishInputs, type PublishMode } from '../src/lib/publish.js';

const none: PublishInputs = { ci: false, token: undefined, project: undefined, projects: undefined, envToken: undefined, envProject: undefined, configProject: null };
const P = '01a0b563-aeff-7c42-ae73-5aab2f2b5a01';

test.each<[string, Partial<PublishInputs>, PublishMode['kind'], RegExp[]]>([
    ['a publish without --ci goes to one project, as it always did', {}, 'project', []],
    ['a token publish with a project in the environment is not CI', { envToken: 'yk_x', envProject: P }, 'project', []],
    ['the OIDC variables alone never select CI mode; only --ci does', { token: 'yk_x' }, 'project', []],
    ['--ci alone publishes by the link', { ci: true }, 'ci', []],
    ['--ci with --token is refused', { ci: true, token: 'yk_x' }, 'refused', [/drop --token/]],
    ['--ci with --project is refused', { ci: true, project: P }, 'refused', [/use --projects instead of --project/]],
    ['--ci with both is refused for both', { ci: true, token: 'yk_x', project: P }, 'refused', [/drop --token/, /instead of --project/]],
    ['--projects without --ci is refused, since a token publishes to its one project', { projects: P }, 'refused', [/--projects is only for --ci/]],
    ['--projects naming something that is not a project id is refused', { ci: true, projects: `${P}, ex1` }, 'refused', [/"ex1", which is not a project id/]],
    ['--ci ignores YUKIBANA_PROJECT, and says so', { ci: true, envProject: P }, 'ci', [/YUKIBANA_PROJECT \(01a0b563-.*\) is ignored/]],
    ['--ci ignores YUKIBANA_TOKEN, and says so', { ci: true, envToken: 'yk_x' }, 'ci', [/YUKIBANA_TOKEN is set and ignored/]],
    ['--ci ignores an empty YUKIBANA_TOKEN and YUKIBANA_PROJECT, which the Action passes, silently', { ci: true, envToken: '', envProject: '' }, 'ci', []],
    ["--ci ignores the yukibana.json's projectId, and says so", { ci: true, configProject: P }, 'ci', [/projectId in yukibana\.json .* is ignored/]],
])('%s', (_, over, kind, sentences) => {
    const mode = publishModeOf({ ...none, ...over });
    assert.equal(mode.kind, kind);
    const said = mode.kind === 'refused' ? mode.problems : mode.kind === 'ci' ? mode.warnings : [];
    assert.equal(said.length, sentences.length, said.join('\n'));
    sentences.forEach((re, i) => assert.match(said[i] ?? '', re));
});

test('--projects takes ids separated by commas or white space, once each, in its order', () => {
    const Q = '01a0b563-aeff-7c42-ae73-5aab2f2b5a02';
    const mode = publishModeOf({ ...none, ci: true, projects: ` ${Q},${P}\n${Q} ` });
    assert.equal(mode.kind, 'ci');
    assert.deepEqual(mode.kind === 'ci' ? mode.named : null, [Q, P]);
    const empty = publishModeOf({ ...none, ci: true, projects: '' });
    assert.deepEqual(empty.kind === 'ci' ? empty.named : null, []);
});

const project = (slug: string, refused: string | null = null): CiProject => ({ id: `id-${slug}`, slug, title: slug.toUpperCase(), edition: 'Intro, 2026 autumn', refused });
const answer = (projects: CiProject[], moved: string | null = null): CiProjects => ({
    repository: 'ada/course',
    ref: 'refs/tags/v1',
    sha: 'abcdef0123456789'.repeat(2) + '01234567',
    moved,
    projects,
});
const MOVED = 'This repository moved to another owner; link it again on the project page.';
const TAGS = 'Only tags publish; this run is at refs/heads/main.';
const GONE = 'The person who linked this repository is no longer an owner of this edition; an owner must link it again.';

const both = ['id-a', 'id-b'];

test.each<[string, CiProjects, string[], string[], (string | RegExp)[], (string | RegExp)[]]>([
    ['a repository linked to two projects and naming both publishes to both', answer([project('a'), project('b')]), both, ['id-a', 'id-b'], [], []],
    [
        'a linked project the repository does not name is sent nothing, and only warned about, so a link made by somebody who lost access to the repository publishes nothing',
        answer([project('a'), project('stranger')]),
        ['id-a'],
        ['id-a'],
        [],
        [/^stranger \(Intro, 2026 autumn\) is linked to this repository, which does not name it, so nothing was published there; add id-stranger/],
    ],
    [
        'a repository that names no project publishes nothing and fails, once the log has listed the ids it could name',
        answer([project('a'), project('b')]),
        [],
        [],
        [NOTHING_NAMED],
        [],
    ],
    ['a named project the repository is not linked to fails the job', answer([project('a')]), ['id-a', 'id-x'], ['id-a'], [`not published to id-x: ${NAMED_NOT_LINKED}`], []],
    ['a repository linked to nothing publishes nothing and fails, pointing at the project page', answer([]), [], [], [NOTHING_LINKED], []],
    ['a moved repository with no current link fails with the sentence about moving', answer([], MOVED), [], [], [MOVED], []],
    ['old links of a moved repository warn, and do not fail its new links', answer([project('a')], MOVED), ['id-a'], ['id-a'], [], [MOVED]],
    [
        'a run on a branch publishes to nothing and fails for every named project',
        answer([project('a', TAGS), project('b', TAGS)]),
        both,
        [],
        [/^not published to a .*Only tags/, /^not published to b .*Only tags/],
        [],
    ],
    [
        'a named link whose owner left is skipped and fails the job, while the others publish',
        answer([project('a'), project('b', GONE)]),
        both,
        ['id-a'],
        [/^not published to b \(Intro, 2026 autumn\): The person who linked/],
        [],
    ],
    [
        'a link whose owner left that the repository no longer names is only warned about, so a dead link nobody can remove does not fail every tag',
        answer([project('a'), project('b', GONE)]),
        ['id-a'],
        ['id-a'],
        [],
        [/^b \(Intro, 2026 autumn\) is linked to this repository, which does not name it/],
    ],
])('%s', (_, given, named, targets, problems, warnings) => {
    const plan = ciPlanOf(given, named);
    assert.deepEqual(
        plan.targets.map(t => t.id),
        targets,
    );
    const same = (said: readonly string[], expected: (string | RegExp)[]): void => {
        assert.equal(said.length, expected.length, said.join('\n'));
        expected.forEach((p, i) => (typeof p === 'string' ? assert.equal(said[i], p) : assert.match(said[i] ?? '', p)));
    };
    same(plan.problems, problems);
    same(plan.warnings, warnings);
});

test('the job log names the repository, the ref and the short commit, then every linked project, with its id and why any is skipped', () => {
    const plan = ciPlanOf(answer([project('a'), project('b', GONE), project('c')]), both);
    assert.deepEqual(plan.lines, [
        'ada/course at refs/tags/v1 (abcdef012345) is linked to 3 projects',
        '  publishes to a "A" (Intro, 2026 autumn, id-a)',
        `  skips b "B" (Intro, 2026 autumn, id-b): ${GONE}`,
        '  skips c "C" (Intro, 2026 autumn, id-c): this repository does not name it',
    ]);
});
