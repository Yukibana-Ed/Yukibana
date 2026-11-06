/**
 * SPDX-License-Identifier: MIT
 */
// The CI workflow's plan: which packages one run checks, and which of the heavy jobs it runs. pnpm's package graph
// decides, not lists of paths: a package is affected when a file in it changed (Markdown aside, see
// changedFilesIgnorePattern in pnpm-workspace.yaml) or when it depends on an affected package.
//
//   BASE=<sha> node .github/scripts/plan.mts     # in CI, which also sets GITHUB_OUTPUT
//
// BASE is the commit the run compares with: the pull request's base, the merge queue's base, or the commit a push
// replaced. Without one (a run by hand, a new branch), everything runs.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import path from 'node:path';

/** A workspace package, as `pnpm list` reports it. */
export interface WorkspacePackage {
    /** The package's name; `undefined` for the workspace root, which has none. */
    readonly name: string | undefined;
    /** The package's directory, relative to the repository root, with `/` separators; `''` for the root. */
    readonly dir: string;
}

/**
 * What changed since the base, as far as the plan needs to know.
 *
 * - `unknown`: there is no base to compare with, so everything is affected.
 * - `shared`: a file that belongs to no package but the workspace root changed (the lockfile, a root config,
 *   `.github/`, `cloud/dev/`, ...), which any package may read, so every package is affected.
 * - `packages`: only files inside packages changed; `affected` are those packages and every package depending on them.
 */
export type Change =
    | { readonly kind: 'unknown'; readonly reason: string }
    | { readonly kind: 'shared'; readonly files: readonly string[] }
    | { readonly kind: 'packages'; readonly affected: readonly string[]; readonly files: readonly string[] };

/** What one CI run does. */
export interface Plan {
    /** The names of the packages whose `lint`, `typecheck`, `test` and `build` scripts run, sorted. */
    readonly packages: readonly string[];
    /** `true` iff the cloud stack runs: the migrations from empty, pgTAP and the Worker's integration tests. */
    readonly cloud: boolean;
    /** `true` iff the IDE's end-to-end tests run, on every OS. */
    readonly ide: boolean;
    /** `true` iff the cloud's devcontainer is built and its smoke test run. */
    readonly devcontainer: boolean;
    /** `true` iff the licenses of the npm dependencies and of the IDE's bundled plugins are checked. */
    readonly licenses: boolean;
    /** `true` iff a pull request's Worker may be uploaded as a preview: the Worker is affected and `cloud/db` is not touched. */
    readonly preview: boolean;
}

/** The packages whose being affected starts the cloud stack. */
export const CLOUD_PACKAGES: readonly string[] = ['@yukibana/cloud-web', '@yukibana/cloud-db'];

/**
 * The packages whose being affected starts the IDE's end-to-end tests: the two apps, the tests themselves, and
 * `@yukibana/ide`, which holds the scripts and the Theia CLI that build the apps.
 */
export const IDE_PACKAGES: readonly string[] = ['@yukibana/ide', '@yukibana/ide-browser', '@yukibana/ide-electron', '@yukibana/ide-e2e'];

/**
 * Returns the pnpm selectors of the affected packages: `...[base]`, and `...{dir/**}` for each changed package whose
 * directory holds other packages. `ide/` is one: its configs and scripts are what the packages under it are built
 * with, yet none of them depends on it in the package graph.
 *
 * - Requires: `changed` holds no workspace root; a changed root means every package is affected instead.
 */
export function affectedSelectors(base: string, changed: readonly WorkspacePackage[], all: readonly WorkspacePackage[]): string[] {
    if (changed.some(p => p.dir === '')) {
        throw new Error('affectedSelectors: the workspace root changed, so every package is affected');
    }
    const parents = changed.filter(p => all.some(q => q.dir.startsWith(`${p.dir}/`)));
    return [`...[${base}]`, ...parents.map(p => `...{${p.dir}/**}`)];
}

/**
 * Returns the plan for a change, given the names of every package in the workspace.
 *
 * - Requires: every name in a `packages` change's `affected` is one of `all`.
 */
export function decide(change: Change, all: readonly string[]): Plan {
    if (change.kind === 'unknown') {
        return { packages: [...all].sort(), cloud: true, ide: true, devcontainer: true, licenses: true, preview: false };
    }
    const packages = change.kind === 'shared' ? [...all] : [...change.affected];
    const unknown = packages.filter(p => !all.includes(p));
    if (unknown.length > 0) {
        throw new Error(`decide: not workspace packages: ${unknown.join(', ')}`);
    }
    const { files } = change;
    return {
        packages: packages.sort(),
        cloud: packages.some(p => CLOUD_PACKAGES.includes(p)),
        ide: packages.some(p => IDE_PACKAGES.includes(p)),
        // What the container is built from, and the scripts and compose file its start runs.
        devcontainer: files.some(f => f.startsWith('cloud/dev/')),
        // The npm dependencies are in the lockfile; the plugins are listed in ide/package.json.
        licenses: files.some(f => f === 'pnpm-lock.yaml' || f === 'ide/package.json'),
        // A preview runs against production's database, so not with a migration it would not have.
        preview: packages.includes('@yukibana/cloud-web') && !files.some(f => f.startsWith('cloud/db/')),
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
function changeSince(base: string, all: readonly WorkspacePackage[]): Change {
    const reason = unusableBase(base);
    if (reason !== undefined) {
        return { kind: 'unknown', reason };
    }
    const files = execFileSync('git', ['diff', '--name-only', base, 'HEAD'], { encoding: 'utf8' })
        .split('\n')
        .filter(f => f !== '');
    const changed = pnpmList([`[${base}]`]);
    if (changed.some(p => p.dir === '')) {
        return { kind: 'shared', files };
    }
    return { kind: 'packages', affected: namesOf(pnpmList(affectedSelectors(base, changed, all))), files };
}

if (import.meta.main) {
    const all = pnpmList([]);
    const change = changeSince(process.env['BASE'] ?? '', all);
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
        `Cloud stack: ${plan.cloud}, IDE e2e: ${plan.ide}, devcontainer: ${plan.devcontainer}, licenses: ${plan.licenses}, preview: ${plan.preview}`,
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
