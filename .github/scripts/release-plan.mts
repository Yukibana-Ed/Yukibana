// What a push to main releases: every package whose version in git is a release version that is not out yet. Release
// runs this first, and nothing else decides it. A package is out when its registry has that version (npm for the
// client and the CLI, a tag `ide-v<version>` for the IDE's installers), so the plan is a function of git and of what
// was already published, not of which commit changed what: a run that failed halfway is finished by the next push, or
// by re-running it, and a push that bumps nothing releases nothing.
//
//   node .github/scripts/release-plan.mts     # from the repository root; writes GITHUB_OUTPUT when it is set
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';

/** Where a package's releases go, and so how to ask whether a version is out. */
export type Registry = 'npm' | 'github';

/** A package that Release can release. */
export interface Releasable {
    /** Its name in its manifest. */
    readonly name: string;
    /** Its manifest, relative to the repository root. */
    readonly manifest: string;
    /** Where its releases go. */
    readonly registry: Registry;
    /** The workflow output that says whether it is released, and `<output>-version` its version. */
    readonly output: string;
    /**
     * The workspace packages it depends on with `workspace:*`, by name. `pnpm publish` writes their versions in git into
     * its manifest, so each must be out, or released in the same run, for an install of it to work.
     */
    readonly needs: readonly string[];
}

/**
 * The packages Release releases. The CLI and the IDE both bundle the client they were built with, so each releases on
 * its own; `needs` stays for a package that someday depends on another one published.
 */
export const RELEASABLE: readonly Releasable[] = [
    { name: '@yukibana/client', manifest: 'packages/client/package.json', registry: 'npm', output: 'client', needs: [] },
    { name: '@yukibana/cli', manifest: 'packages/cli/package.json', registry: 'npm', output: 'cli', needs: [] },
    { name: '@yukibana/ide-electron', manifest: 'ide/electron/package.json', registry: 'github', output: 'ide', needs: [] },
];

/** The version every package has in git until someone means to release it, which releases nothing. */
export const UNRELEASED = '0.0.0-dev';

/** The prefix of the tag that marks an IDE release, followed by its version: `ide-v1.2.3`. */
export const IDE_TAG_PREFIX = 'ide-v';

/** A version Release may publish, `X.Y.Z` with no leading zeros and no prerelease part. */
const RELEASE_VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

/** What Release does with one package's version in git. */
export type Decision =
    /** Publish it. */
    | { readonly kind: 'release' }
    /** Nothing, for the reason given, which is not a fault. */
    | { readonly kind: 'skip'; readonly reason: string }
    /** Nothing, and the run fails with this sentence: the version in git cannot be released as it is. */
    | { readonly kind: 'refuse'; readonly reason: string };

/** Whether `version` is a version Release may publish, `X.Y.Z`. */
export function isReleaseVersion(version: string): boolean {
    return RELEASE_VERSION.test(version);
}

/**
 * Returns a negative number, zero or a positive number as `a` is lower than, equal to or higher than `b`.
 *
 * - Requires: both are release versions (`isReleaseVersion`); throws otherwise.
 */
export function compareVersions(a: string, b: string): number {
    const parts = (v: string): number[] => {
        if (!isReleaseVersion(v)) {
            throw new Error(`compareVersions: ${JSON.stringify(v)} is not X.Y.Z`);
        }
        return v.split('.').map(Number);
    };
    const [x, y] = [parts(a), parts(b)];
    for (let i = 0; i < 3; i++) {
        const d = (x[i] ?? 0) - (y[i] ?? 0);
        if (d !== 0) {
            return d;
        }
    }
    return 0;
}

/**
 * What to do with `name` at `version`, given the versions of it already out. Versions out that are not release
 * versions (an old prerelease, say) are ignored when comparing.
 */
export function decide(name: string, version: string, published: readonly string[]): Decision {
    if (version === UNRELEASED) {
        return { kind: 'skip', reason: `${name} is ${UNRELEASED}, which is never released` };
    }
    if (!isReleaseVersion(version)) {
        return { kind: 'refuse', reason: `${name} is ${JSON.stringify(version)}, which is neither ${UNRELEASED} nor a release version X.Y.Z` };
    }
    if (published.includes(version)) {
        return { kind: 'skip', reason: `${name} ${version} is already out` };
    }
    const newest = published.filter(isReleaseVersion).toSorted(compareVersions).at(-1);
    if (newest !== undefined && compareVersions(version, newest) < 0) {
        return { kind: 'refuse', reason: `${name} ${version} is lower than ${newest}, the newest version out; a release goes forward only` };
    }
    return { kind: 'release' };
}

/** One package as the plan sees it: what git says and what is out. */
export interface Observed {
    readonly package: Releasable;
    /** Its version in git. */
    readonly version: string;
    /** The versions of it already out, in any order. */
    readonly published: readonly string[];
}

/** What one run releases. */
export interface Plan {
    /** The packages to release, in `RELEASABLE` order (so the client before the CLI), with their versions. */
    readonly release: readonly { readonly package: Releasable; readonly version: string }[];
    /** Why each other package is not released, one sentence each. */
    readonly skipped: readonly string[];
    /** Why the run must fail, one sentence each; when not empty, nothing may be released. */
    readonly refused: readonly string[];
}

/**
 * The plan for these packages: each one's decision, and a refusal for a package released that needs a workspace package
 * which neither is out at its version in git nor is released with it.
 */
export function plan(observed: readonly Observed[]): Plan {
    const decisions = observed.map(o => ({ ...o, decision: decide(o.package.name, o.version, o.published) }));
    const released = new Set(decisions.filter(d => d.decision.kind === 'release').map(d => d.package.name));
    const refused = decisions.flatMap(d => (d.decision.kind === 'refuse' ? [d.decision.reason] : []));
    for (const r of decisions.filter(d => d.decision.kind === 'release')) {
        for (const need of r.package.needs) {
            const dependency = observed.find(o => o.package.name === need);
            if (dependency === undefined) {
                refused.push(`${r.package.name} needs ${need}, which is not a package Release knows`);
            } else if (!released.has(need) && !dependency.published.includes(dependency.version)) {
                refused.push(`${r.package.name} ${r.version} would depend on ${need} ${dependency.version}, which is not out and is not released with it; bump ${need} too`);
            }
        }
    }
    return {
        release: decisions.filter(d => d.decision.kind === 'release').map(d => ({ package: d.package, version: d.version })),
        skipped: decisions.flatMap(d => (d.decision.kind === 'skip' ? [d.decision.reason] : [])),
        refused,
    };
}

/**
 * The workflow outputs for a plan: for each package, `<output>` is `true` or `false` and `<output>-version` its version
 * in git; `npm` is `true` iff any npm package is released.
 */
export function outputs(observed: readonly Observed[], p: Plan): Record<string, string> {
    const out: Record<string, string> = {};
    for (const o of observed) {
        out[o.package.output] = String(p.release.some(r => r.package.name === o.package.name));
        out[`${o.package.output}-version`] = o.version;
    }
    out['npm'] = String(p.release.some(r => r.package.registry === 'npm'));
    return out;
}

/**
 * The versions of an npm package on the public registry; none when the registry has never heard of it. Asked over HTTP
 * rather than through `npm view`, which in this workspace refuses to run on any Node but devEngines' exact release.
 */
async function npmVersions(name: string): Promise<string[]> {
    const response = await fetch(`https://registry.npmjs.org/${name.replace('/', '%2f')}`, { headers: { accept: 'application/vnd.npm.install-v1+json' } });
    if (response.status === 404) {
        return [];
    }
    if (!response.ok) {
        throw new Error(`the npm registry answered ${response.status} for ${name}`);
    }
    const body: unknown = await response.json();
    const versions = typeof body === 'object' && body !== null && 'versions' in body ? body.versions : undefined;
    if (typeof versions !== 'object' || versions === null) {
        throw new Error(`the npm registry's answer for ${name} has no versions`);
    }
    return Object.keys(versions);
}

/** The prefix of the IDE releases made by hand before this workflow: `v0.1.0`, `v0.2.0`. */
const LEGACY_IDE_TAG_PREFIX = 'v';

/**
 * The IDE versions released, from the tags in this clone (which must have fetched them): `ide-v<version>`, and the
 * `v<version>` of the releases made by hand before, whose installers people have, so that a release goes forward from
 * those too.
 */
function ideVersions(): string[] {
    return execFileSync('git', ['tag', '--list', `${IDE_TAG_PREFIX}*`, `${LEGACY_IDE_TAG_PREFIX}*`], { encoding: 'utf8' })
        .split('\n')
        .map(t => (t.startsWith(IDE_TAG_PREFIX) ? t.slice(IDE_TAG_PREFIX.length) : t.startsWith(LEGACY_IDE_TAG_PREFIX) ? t.slice(LEGACY_IDE_TAG_PREFIX.length) : ''))
        .filter(v => v !== '');
}

if (import.meta.main) {
    const observed: Observed[] = await Promise.all(
        RELEASABLE.map(async p => {
            const manifest: unknown = JSON.parse(readFileSync(p.manifest, 'utf8'));
            const version = typeof manifest === 'object' && manifest !== null && 'version' in manifest ? manifest.version : undefined;
            if (typeof version !== 'string') {
                throw new Error(`${p.manifest} has no version`);
            }
            return { package: p, version, published: p.registry === 'npm' ? await npmVersions(p.name) : ideVersions() };
        }),
    );
    const p = plan(observed);
    for (const r of p.release) {
        process.stdout.write(`release ${r.package.name} ${r.version}\n`);
    }
    for (const s of p.skipped) {
        process.stdout.write(`skip: ${s}\n`);
    }
    for (const r of p.refused) {
        process.stderr.write(`::error::${r}\n`);
    }
    if (p.refused.length > 0) {
        process.exitCode = 1;
    } else if (process.env['GITHUB_OUTPUT'] !== undefined) {
        appendFileSync(
            process.env['GITHUB_OUTPUT'],
            Object.entries(outputs(observed, p))
                .map(([k, v]) => `${k}=${v}\n`)
                .join(''),
        );
    }
}
