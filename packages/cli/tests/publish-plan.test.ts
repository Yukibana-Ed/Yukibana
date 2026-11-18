import { test } from 'vitest';
import assert from 'node:assert/strict';
import type { CiProject, CiProjects } from '@yukibana/client';
import { ciPlanOf, NOTHING_LINKED, publishModeOf, type PublishInputs, type PublishMode } from '../src/lib/publish.js';

const none: PublishInputs = { ci: false, token: undefined, project: undefined, envToken: undefined, envProject: undefined, configProject: null };
const P = '01a0b563-aeff-7c42-ae73-5aab2f2b5a01';

test.each<[string, Partial<PublishInputs>, PublishMode['kind'], RegExp[]]>([
    ['a publish without --ci goes to one project, as it always did', {}, 'project', []],
    ['a token publish with a project in the environment is not CI', { envToken: 'yk_x', envProject: P }, 'project', []],
    ['the OIDC variables alone never select CI mode; only --ci does', { token: 'yk_x' }, 'project', []],
    ['--ci alone publishes by the link', { ci: true }, 'ci', []],
    ['--ci with --token is refused', { ci: true, token: 'yk_x' }, 'refused', [/drop --token/]],
    ['--ci with --project is refused', { ci: true, project: P }, 'refused', [/drop --project/]],
    ['--ci with both is refused for both', { ci: true, token: 'yk_x', project: P }, 'refused', [/drop --token/, /drop --project/]],
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

test.each<[string, CiProjects, string[], (string | RegExp)[], string[]]>([
    ['a repository linked to two projects publishes to both', answer([project('a'), project('b')]), ['id-a', 'id-b'], [], []],
    ['a repository linked to nothing publishes nothing and fails, pointing at the project page', answer([]), [], [NOTHING_LINKED], []],
    ['a moved repository with no current link fails with the sentence about moving', answer([], MOVED), [], [MOVED], []],
    ['old links of a moved repository warn, and do not fail its new links', answer([project('a')], MOVED), ['id-a'], [], [MOVED]],
    [
        'a run on a branch publishes to nothing and fails for every project',
        answer([project('a', TAGS), project('b', TAGS)]),
        [],
        [/^not published to a .*Only tags/, /^not published to b .*Only tags/],
        [],
    ],
    [
        'a link whose owner left is skipped and fails the job, while the others publish',
        answer([project('a'), project('b', GONE)]),
        ['id-a'],
        [/^not published to b \(Intro, 2026 autumn\): The person who linked/],
        [],
    ],
])('%s', (_, given, targets, problems, warnings) => {
    const plan = ciPlanOf(given);
    assert.deepEqual(
        plan.targets.map(t => t.id),
        targets,
    );
    assert.equal(plan.problems.length, problems.length, plan.problems.join('\n'));
    problems.forEach((p, i) => (typeof p === 'string' ? assert.equal(plan.problems[i], p) : assert.match(plan.problems[i] ?? '', p)));
    assert.deepEqual(plan.warnings, warnings);
});

test('the job log names the repository, the ref and the short commit, then every project with why any is skipped', () => {
    const plan = ciPlanOf(answer([project('a'), project('b', GONE)]));
    assert.deepEqual(plan.lines, [
        'ada/course at refs/tags/v1 (abcdef012345) is linked to 2 projects',
        '  publishes to a "A" (Intro, 2026 autumn)',
        `  skips b "B" (Intro, 2026 autumn): ${GONE}`,
    ]);
});
