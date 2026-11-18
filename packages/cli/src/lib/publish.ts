/** What `yukibana publish` will do, decided before anything is built or
 *  sent: which way it publishes, and, in CI mode, to which projects.
 *
 *  Pure, so that the decisions are tested as tables; `commands/release.ts`
 *  does the I/O around them.
 */

import type { CiProject, CiProjects } from '@yukibana/client';

/** What the command line and the environment say about how to publish. */
export interface PublishInputs {
    /** `--ci`: publish by the repository's link, with GitHub Actions' OIDC token. */
    readonly ci: boolean;
    /** `--token`, as given; undefined when absent. */
    readonly token: string | undefined;
    /** `--project`, as given; undefined when absent. */
    readonly project: string | undefined;
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
          /** By the repository's link, to every project the registry lists for
           *  it, with the job's OIDC token. */
          readonly kind: 'ci';
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
 *  way of saying where a release goes. Under `--ci`, `YUKIBANA_TOKEN`,
 *  `YUKIBANA_PROJECT` and a `projectId` in yukibana.json are ignored with a
 *  warning: the registry says where the release goes, from the link. */
export function publishModeOf(inputs: PublishInputs): PublishMode {
    if (!inputs.ci) return { kind: 'project' };
    const problems: string[] = [];
    if (inputs.token !== undefined) problems.push("--ci publishes with the job's OIDC token, not a project token; drop --token, or drop --ci to publish with the token");
    if (inputs.project !== undefined)
        problems.push('--ci publishes to every project linked to the repository; drop --project, or drop --ci to publish to that project with a token');
    if (problems.length > 0) return { kind: 'refused', problems };
    const warnings: string[] = [];
    if (set(inputs.envToken)) warnings.push("YUKIBANA_TOKEN is set and ignored: --ci publishes with the job's OIDC token");
    if (set(inputs.envProject)) warnings.push(`YUKIBANA_PROJECT (${inputs.envProject}) is ignored: --ci publishes to every project linked to the repository`);
    if (inputs.configProject !== null)
        warnings.push(`the projectId in yukibana.json (${inputs.configProject}) is ignored: --ci publishes to every project linked to the repository`);
    return { kind: 'ci', warnings };
}

const set = (v: string | undefined): v is string => v !== undefined && v !== '';

/** What a CI job does with the registry's answer to `ciProjects()`. */
export interface CiPlan {
    /** What to print before anything is built, one line each: the
     *  repository, ref and commit, then every project, published or skipped
     *  with its reason, so the job log shows every link of the repository. */
    readonly lines: readonly string[];
    /** The projects to build for and publish to, in the registry's order
     *  (edition, then slug); possibly none. */
    readonly targets: readonly CiProject[];
    /** What fails the job however the publishes go, one sentence each: a
     *  project the registry would refuse, or a repository that publishes to
     *  nothing. Empty when every listed project is a target. */
    readonly problems: readonly string[];
    /** What is printed as a warning and does not fail the job: that links
     *  made under a previous owner of the repository publish nothing, when
     *  links under its current owner exist. Those old links belong to
     *  projects the current owner has no say over, and must not fail every
     *  run of theirs. */
    readonly warnings: readonly string[];
}

/** The sentence for a repository linked to no project at all. */
export const NOTHING_LINKED =
    'this repository is linked to no project, so there is nothing to publish to; an owner of the project links it on the project page (Releases, Repository)';

/** Returns what to do with `answer`. Every project the registry would accept
 *  is a target; every one it would refuse is skipped, printed with the
 *  registry's own sentence, and fails the job at the end, so a link that
 *  stopped working (a run not at a tag, a linking owner who left) is never
 *  a green job that published less than it seems. A moved repository with
 *  no current link fails with the registry's sentence about moving; with
 *  current links, it is a warning. No link at all fails with
 *  `NOTHING_LINKED`. Pure. */
export function ciPlanOf(answer: CiProjects): CiPlan {
    const lines = [`${answer.repository} at ${answer.ref} (${answer.sha.slice(0, 12)}) is linked to ${count(answer.projects.length)}`];
    const targets: CiProject[] = [];
    const problems: string[] = [];
    for (const p of answer.projects) {
        const name = `${p.slug} "${p.title}" (${p.edition})`;
        if (p.refused === null) {
            targets.push(p);
            lines.push(`  publishes to ${name}`);
        } else {
            lines.push(`  skips ${name}: ${p.refused}`);
            problems.push(`not published to ${p.slug} (${p.edition}): ${p.refused}`);
        }
    }
    const warnings: string[] = [];
    if (answer.moved !== null) (answer.projects.length === 0 ? problems : warnings).push(answer.moved);
    else if (answer.projects.length === 0) problems.push(NOTHING_LINKED);
    return { lines, targets, problems, warnings };
}

const count = (n: number): string => (n === 1 ? '1 project' : `${n} projects`);
