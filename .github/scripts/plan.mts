/**
 * SPDX-License-Identifier: MIT
 */
// The CI workflow's plan: which packages one run checks, and which of the heavy jobs it runs. pnpm's package graph
// decides, not lists of paths: a package is affected when a file in it changed (Markdown aside, see
// changedFilesIgnorePattern in pnpm-workspace.yaml) or when it depends on an affected package.
//
//   BASE=<sha> node .github/scripts/plan.mts     # in CI, which also sets GITHUB_OUTPUT
//
// BASE is the commit the run compares with: the pull request's base, the merge queue's base,
// or (deploy-cloud.yml) the last commit deployed. Without one (a run by hand, a new branch), everything runs.
// ci.yml reads every output but `deploy`; deploy-cloud.yml reads only `deploy`.
//
// A test-only dependency counts like any other: packages/fixtures is a devDependency of the client, the CLI and the
// Worker, so a change to the fixture repository affects those and everything depending on them, and deploys and runs
// the IDE's end-to-end tests. Accepted: the fixture rarely changes, and telling the graph's edges apart is machinery.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import path from 'node:path';

/** A workspace package, as `pnpm list` reports it. */
interface WorkspacePackage {
    /** The package's name; `undefined` for the workspace root, which has none. */
    readonly name: string | undefined;
    /** The package's directory, relative to the repository root, with `/` separators; `''` for the root. */
    readonly dir: string;
}

/**
 * What changed since the base, as far as the plan needs to know.
 *
 * - `unknown`: there is no base to compare with, so everything is affected.
 * - `shared`: a file other than Markdown that belongs to no package but the workspace root changed (the lockfile, a
 *   root config, a workflow, ...), which any package may read, so every package is checked.
 * - `packages`: otherwise. Markdown is left out of the decision (changedFilesIgnorePattern in pnpm-workspace.yaml), so
 *   a change only to Markdown outside the packages (the root README.md, docs/...) is `packages` with `affected` empty.
 *
 * `affected` are the packages with changed files other than Markdown, and every package depending on one whose non-test
 * files changed: a change only to a package's tests affects that package alone (testPattern in pnpm-workspace.yaml).
 * `files` are all the changed files, Markdown included, relative to the repository root.
 */
export type Change =
    | {
          /** There is no base to compare with. */
          readonly kind: 'unknown';
          /** Why not, as a clause for a person: "there is no base commit (a run by hand)". */
          readonly reason: string;
      }
    | {
          /** `shared` iff a file other than Markdown outside every package changed; `packages` otherwise, also when
           *  the only files outside the packages that changed are Markdown. */
          readonly kind: 'shared' | 'packages';
          /** The names of the packages with changed files other than Markdown, and of every package depending on one
           *  whose non-test files changed; not the root. A change only to a package's tests affects that package alone
           *  (testPattern and changedFilesIgnorePattern in pnpm-workspace.yaml). May be empty. */
          readonly affected: readonly string[];
          /** The changed files, Markdown included, relative to the repository root, with `/` separators. */
          readonly files: readonly string[];
      };

/** What one CI run does. */
export interface Plan {
    /**
     * The names of the packages whose `lint`, `typecheck`, `test` and `build` scripts run, sorted; `build` runs for all of
     * them except `@yukibana/ide`, whose apps the end-to-end job builds (`pnpm -C ide test:e2e`).
     */
    readonly packages: readonly string[];
    /**
     * `true` iff the cloud stack runs: the migrations from empty, pgTAP and the Worker's integration tests; a package in
     * `CLOUD_STACK_PACKAGES` is among `packages`.
     */
    readonly cloud: boolean;
    /** `true` iff the IDE's end-to-end tests run, on every OS: a package in `IDE_PACKAGES` is among `packages`. */
    readonly ide: boolean;
    /** `true` iff the cloud's devcontainer is built and its smoke test run: `cloud/dev/` or one of `DEVCONTAINER_INPUTS` changed. */
    readonly devcontainer: boolean;
    /** `true` iff the licenses of the npm dependencies and of the IDE's bundled plugins are checked. */
    readonly licenses: boolean;
    /**
     * `true` iff a pull request's Worker may be uploaded as a preview: a file in `cloud/web` or in a package it depends on
     * changed. A change to `cloud/db` does not rule one out; its preview runs without the change's migrations, and its
     * comment says so. A change outside every package alone (CI, a root config, the lockfile) has none, so that it leaves
     * no approval waiting. Without a base there is no preview either.
     */
    readonly preview: boolean;
    /**
     * `true` iff Deploy cloud deploys: what it deploys may have changed, because a package in `CLOUD_PACKAGES` is affected
     * or one of `DEPLOY_INPUTS` changed. A change to CI or a root config alone does not deploy.
     */
    readonly deploy: boolean;
}

/** The packages whose being affected deploys. */
const CLOUD_PACKAGES: ReadonlySet<string> = new Set(['@yukibana/cloud-web', '@yukibana/cloud-db']);

/** The packages whose being affected starts the cloud stack: what it deploys, and the scripts that check the stack. */
const CLOUD_STACK_PACKAGES: ReadonlySet<string> = new Set([...CLOUD_PACKAGES, '@yukibana/cloud-dev']);

/** The files no package owns that every install reads: a change to one can change what any package is built with. */
const INSTALL_INPUTS: readonly string[] = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'];

/** The files no package owns whose change deploys the cloud: what it is installed with, and the deploy itself. */
const DEPLOY_INPUTS: ReadonlySet<string> = new Set([...INSTALL_INPUTS, '.github/workflows/deploy-cloud.yml', '.github/scripts/production-config.mts']);

/**
 * The files outside `cloud/dev/` that the devcontainer is built from: what every install reads, the manifests of the
 * packages its install selects (`{cloud/**}...` and `@yukibana/cli...`), and the Supabase stack its start runs.
 */
const DEVCONTAINER_INPUTS: ReadonlySet<string> = new Set([
    ...INSTALL_INPUTS,
    'cloud/db/package.json',
    'cloud/web/package.json',
    'packages/cli/package.json',
    'packages/client/package.json',
    'packages/fixtures/package.json',
    'cloud/db/supabase/config.toml',
]);

/**
 * The packages whose being affected starts the IDE's end-to-end tests: the two apps, the tests themselves, and
 * `@yukibana/ide`, which holds the scripts and the Theia CLI that build the apps.
 */
const IDE_PACKAGES: ReadonlySet<string> = new Set(['@yukibana/ide', '@yukibana/ide-browser', '@yukibana/ide-electron', '@yukibana/ide-e2e']);

/** The files whose change runs the license check: what it checks, and its rules. */
const LICENSE_INPUTS: ReadonlySet<string> = new Set(['pnpm-lock.yaml', 'ide/package.json', '.github/scripts/licenses.mts']);

/**
 * Returns the plan for a change, given the names of every package in the workspace.
 *
 * - Requires: every name in a `shared` or `packages` change's `affected` is one of `all`. Enforced: throws an `Error`
 *   naming the others.
 */
export function decide(change: Change, all: readonly string[]): Plan {
    if (change.kind === 'unknown') {
        return { packages: all.toSorted(), cloud: true, ide: true, devcontainer: true, licenses: true, preview: false, deploy: true };
    }
    const packages = change.kind === 'shared' ? all : change.affected;
    const unknown = change.affected.filter(p => !all.includes(p));
    if (unknown.length > 0) {
        throw new Error(`decide: not workspace packages: ${unknown.join(', ')}`);
    }
    const { files } = change;
    return {
        packages: packages.toSorted(),
        cloud: packages.some(p => CLOUD_STACK_PACKAGES.has(p)),
        ide: packages.some(p => IDE_PACKAGES.has(p)),
        // What the container is built from, the scripts and compose file its start runs, and what it installs from.
        devcontainer: files.some(f => f.startsWith('cloud/dev/') || DEVCONTAINER_INPUTS.has(f)),
        // The npm dependencies are in the lockfile, the plugins are listed in ide/package.json, and the rules are checked
        // against the real tree when they change.
        licenses: files.some(f => LICENSE_INPUTS.has(f)),
        preview: change.affected.includes('@yukibana/cloud-web'),
        deploy: change.affected.some(p => CLOUD_PACKAGES.has(p)) || files.some(f => DEPLOY_INPUTS.has(f)),
    };
}

/** Returns the plan as the lines of a GitHub Actions output file (`name=value`). */
export function outputLines(plan: Plan): string {
    return [
        `packages=${JSON.stringify(plan.packages)}`,
        `cloud=${plan.cloud}`,
        `ide=${plan.ide}`,
        `devcontainer=${plan.devcontainer}`,
        `licenses=${plan.licenses}`,
        `preview=${plan.preview}`,
        `deploy=${plan.deploy}`,
        '',
    ].join('\n');
}

/** Returns why `base` cannot be compared with, or `undefined` when it can. */
function unusableBase(base: string): string | undefined {
    if (!/^[0-9a-f]{40}$/.test(base) || /^0+$/.test(base)) {
        return base === '' ? 'there is no base commit (a run by hand)' : `the base ${JSON.stringify(base)} is not a commit (a new branch)`;
    }
    try {
        execFileSync('git', ['cat-file', '-e', `${base}^{commit}`], { stdio: 'ignore' });
        return undefined;
    } catch {
        return `the base ${base} is not in this clone (a force push?)`;
    }
}

/** Returns the packages that pnpm selects with these filters (every package, the root too, for none), from the repository root. */
function pnpmList(filters: readonly string[]): WorkspacePackage[] {
    const select = filters.length === 0 ? ['-r'] : filters.flatMap(f => ['--filter', f]);
    const json: unknown = JSON.parse(execFileSync('pnpm', [...select, 'list', '--json', '--depth', '-1'], { encoding: 'utf8' }));
    if (!Array.isArray(json)) {
        throw new Error(`pnpm list printed something other than an array: ${JSON.stringify(json)}`);
    }
    return json.map((entry: unknown) => {
        if (typeof entry !== 'object' || entry === null || !('path' in entry) || typeof entry.path !== 'string') {
            throw new Error(`pnpm list printed a package without a path: ${JSON.stringify(entry)}`);
        }
        const name = 'name' in entry && typeof entry.name === 'string' ? entry.name : undefined;
        return { name, dir: path.relative(process.cwd(), entry.path).split(path.sep).join('/') };
    });
}

/** Returns the names of these packages, failing on one without a name (only the root may have none). */
function namesOf(packages: readonly WorkspacePackage[]): string[] {
    return packages.map(p => {
        if (p.name === undefined) {
            throw new Error(`the package in ${JSON.stringify(p.dir)} has no name`);
        }
        return p.name;
    });
}

/** Returns what changed since `base`, asking git and pnpm. */
function changeSince(base: string): Change {
    const reason = unusableBase(base);
    if (reason !== undefined) {
        return { kind: 'unknown', reason };
    }
    const files = execFileSync('git', ['diff', '--name-only', base, 'HEAD'], { encoding: 'utf8' })
        .split('\n')
        .filter(f => f !== '');
    // `...[base]` selects the root too when a file outside every package changed (no package depends on the root); it is
    // not a package to run.
    const selected = pnpmList([`...[${base}]`]);
    const affected = namesOf(selected.filter(p => p.dir !== ''));
    return { kind: selected.some(p => p.dir === '') ? 'shared' : 'packages', affected, files };
}

if (import.meta.main) {
    const all = pnpmList([]);
    const change = changeSince(process.env['BASE'] ?? '');
    const plan = decide(change, namesOf(all.filter(p => p.dir !== '')));
    const why =
        change.kind === 'unknown'
            ? `Everything runs: ${change.reason}.`
            : change.kind === 'shared'
              ? 'Everything runs: a file outside every package changed.'
              : 'The affected packages run.';
    const summary = [
        why,
        '',
        `Packages: ${plan.packages.length === 0 ? 'none' : plan.packages.join(', ')}`,
        `Cloud stack: ${plan.cloud}, IDE e2e: ${plan.ide}, devcontainer: ${plan.devcontainer}, licenses: ${plan.licenses}, preview: ${plan.preview}, deploy: ${plan.deploy}`,
        '',
    ].join('\n');
    process.stdout.write(summary);
    const output = process.env['GITHUB_OUTPUT'];
    if (output !== undefined) {
        appendFileSync(output, outputLines(plan));
    }
    const stepSummary = process.env['GITHUB_STEP_SUMMARY'];
    if (stepSummary !== undefined) {
        appendFileSync(stepSummary, summary);
    }
}
