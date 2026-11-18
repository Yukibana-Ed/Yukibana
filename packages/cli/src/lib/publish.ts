/** What `yukibana publish` will do, decided before anything is built or
 *  sent: which way it publishes, and, in CI mode, to which projects.
 *
 *  Pure, so that the decisions are tested as tables; `commands/release.ts`
 *  does the I/O around them.
 */

import type { CiProject, CiProjects } from '@yukibana/client';
import { isProjectId } from '@yukibana/client/config';

/** What the command line and the environment say about how to publish. */
export interface PublishInputs {
    /** `--ci`: publish by the repository's link, with GitHub Actions' OIDC token. */
    readonly ci: boolean;
    /** `--token`, as given; undefined when absent. */
    readonly token: string | undefined;
    /** `--project`, as given; undefined when absent. */
    readonly project: string | undefined;
    /** `--projects`, as given: the project ids, separated by commas or
     *  white space, that the repository publishes to under `--ci`; undefined
     *  when absent. */
    readonly projects: string | undefined;
    /** `YUKIBANA_TOKEN`; undefined or '' when unset. */
    readonly envToken: string | undefined;
    /** `YUKIBANA_PROJECT`; undefined or '' when unset. */
    readonly envProject: string | undefined;
    /** The `projectId` in the directory's yukibana.json; null when it names none or there is none. */
    readonly configProject: string | null;
}

/** How a publish goes, or why it cannot start. */
export type PublishMode =
    | {
          /** By a project token or as the person logged in, to the one project
           *  `projectOf` resolves, exactly as before CI mode existed. */
          readonly kind: 'project';
      }
    | {
          /** By the repository's link, with the job's OIDC token, to the
           *  projects the registry lists for it, or only to those of them the
           *  repository names (`named`) when it names any. */
          readonly kind: 'ci';
          /** The project ids `--projects` names, in its order, without
           *  repeats; none means every linked project. */
          readonly named: readonly string[];
          /** What CI mode ignores and says so: a project or token set in the
           *  environment or the yukibana.json, never an error, because a
           *  template's yukibana.json may well name the project it was made
           *  for. Sentences, possibly none. */
          readonly warnings: readonly string[];
      }
    | {
          /** The command line contradicts itself; nothing is built. */
          readonly kind: 'refused';
          /** Why, one sentence each; never empty. */
          readonly problems: readonly string[];
      };

/** Returns how `inputs` publish. CI mode is only ever explicit (`--ci`): an
 *  OIDC variable in the environment never selects it, so a token workflow
 *  whose secret is empty keeps saying that the token is missing. `--ci`
 *  with `--token` or `--project` is refused, since each names a different
 *  way of saying where a release goes, and so is `--projects` without
 *  `--ci`, or naming anything but project ids. Under `--ci`,
 *  `YUKIBANA_TOKEN`, `YUKIBANA_PROJECT` and a `projectId` in yukibana.json
 *  are ignored with a warning: a release goes where the link and
 *  `--projects` both say. */
export function publishModeOf(inputs: PublishInputs): PublishMode {
    if (!inputs.ci) {
        if (inputs.projects === undefined) return { kind: 'project' };
        return {
            kind: 'refused',
            problems: ['--projects is only for --ci, where it names the linked projects a repository publishes to; use --project to publish to one with a token'],
        };
    }
    const problems: string[] = [];
    if (inputs.token !== undefined) problems.push("--ci publishes with the job's OIDC token, not a project token; drop --token, or drop --ci to publish with the token");
    if (inputs.project !== undefined)
        problems.push('--ci publishes to the linked projects --projects names; use --projects instead of --project, or drop --ci to publish to that project with a token');
    const named = [...new Set((inputs.projects ?? '').split(/[\s,]+/).filter(id => id !== ''))];
    for (const id of named) if (!isProjectId(id)) problems.push(`--projects names "${id}", which is not a project id (a uuidv7, on the project page)`);
    if (problems.length > 0) return { kind: 'refused', problems };
    const warnings: string[] = [];
    if (set(inputs.envToken)) warnings.push("YUKIBANA_TOKEN is set and ignored: --ci publishes with the job's OIDC token");
    if (set(inputs.envProject)) warnings.push(`YUKIBANA_PROJECT (${inputs.envProject}) is ignored: --ci publishes to the projects linked to the repository`);
    if (inputs.configProject !== null)
        warnings.push(`the projectId in yukibana.json (${inputs.configProject}) is ignored: --ci publishes to the projects linked to the repository`);
    return { kind: 'ci', named, warnings };
}

const set = (v: string | undefined): v is string => v !== undefined && v !== '';

/** What a CI job does with the registry's answer to `ciProjects()`. */
export interface CiPlan {
    /** What to print before anything is built, one line each: the
     *  repository, ref and commit, then every linked project, published or
     *  skipped with its reason, so the job log shows every link of the
     *  repository, with the id `--projects` would name it by. */
    readonly lines: readonly string[];
    /** The projects to build for and publish to, in the registry's order
     *  (edition, then slug); possibly none. */
    readonly targets: readonly CiProject[];
    /** What fails the job however the publishes go, one sentence each: a
     *  project the repository names that the registry would refuse or does
     *  not list, a repository that names none, or one that publishes to
     *  nothing. Empty when every named project is a target. */
    readonly problems: readonly string[];
    /** What is printed as a warning and does not fail the job: a linked
     *  project the repository does not name, and links made under a previous
     *  owner of the repository, when links under its current owner exist.
     *  Neither is the repository's to remove, and neither may fail every run
     *  of it. */
    readonly warnings: readonly string[];
}

/** The sentence for a repository linked to no project at all. */
export const NOTHING_LINKED =
    'this repository is linked to no project, so there is nothing to publish to; an owner of the project links it on the project page (Releases, Repository)';

/** The sentence for a project the repository names that the registry does not list. */
export const NAMED_NOT_LINKED = 'it is not linked to this repository (under its current owner); an owner of the project links it on the project page (Releases, Repository)';

/** Returns what to do with `answer` when the repository names `named`.
 *
 *  By default (`named` empty) a release goes to every project the registry
 *  lists for the repository: several projects may share one repository, and
 *  a teacher who links one more should not have to edit the repository too.
 *  A repository that names projects (`--projects`) publishes only to those
 *  of them that are linked, and a linked project it does not name is
 *  printed and warned about, and sent nothing. That is the repository's
 *  say over a link, which is made on the project page by a person who could
 *  then administer the repository, and which only an owner of the project
 *  can remove: without it, somebody who once administered the repository
 *  and linked it to a project of their own keeps receiving the teacher
 *  archive after losing their access (docs/cloud/github.md, "Many
 *  projects, one repository"). A project the run would publish to that the registry
 *  would refuse, or a named one it does not list, is printed with the
 *  reason and fails the job at the end, so a link that stopped working (a
 *  run not at a tag, a linking owner who left) is never a green job that
 *  published less than it seems. A moved repository with no current link
 *  fails with the registry's sentence about moving; with current links, it
 *  is a warning. No link at all fails with `NOTHING_LINKED`. Pure. */
export function ciPlanOf(answer: CiProjects, named: readonly string[]): CiPlan {
    const lines = [`${answer.repository} at ${answer.ref} (${answer.sha.slice(0, 12)}) is linked to ${count(answer.projects.length)}`];
    const targets: CiProject[] = [];
    const problems: string[] = [];
    const warnings: string[] = [];
    const wanted = new Set(named);
    for (const p of answer.projects) {
        const name = `${p.slug} "${p.title}" (${p.edition}, ${p.id})`;
        if (named.length > 0 && !wanted.has(p.id)) {
            lines.push(`  skips ${name}: this repository does not name it`);
            warnings.push(
                `${p.slug} (${p.edition}) is linked to this repository, which does not name it, so nothing was published there; add ${p.id} to \`projects\` to publish there`,
            );
        } else if (p.refused === null) {
            targets.push(p);
            lines.push(`  publishes to ${name}`);
        } else {
            lines.push(`  skips ${name}: ${p.refused}`);
            problems.push(`not published to ${p.slug} (${p.edition}): ${p.refused}`);
        }
    }
    const listed = new Set(answer.projects.map(p => p.id));
    for (const id of named) if (!listed.has(id)) problems.push(`not published to ${id}: ${NAMED_NOT_LINKED}`);
    if (answer.moved !== null) (answer.projects.length === 0 ? problems : warnings).push(answer.moved);
    else if (answer.projects.length === 0) problems.push(NOTHING_LINKED);
    return { lines, targets, problems, warnings };
}

const count = (n: number): string => (n === 1 ? '1 project' : `${n} projects`);
