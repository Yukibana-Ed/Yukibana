// What a push to main releases: every package whose version in git is a release version that is not out yet. Release
// runs this first, and nothing else decides it. A package is out when its registry has that version (npm for the
// client and the CLI, a tag `ide-v<version>` for the IDE's installers), so the plan is a function of git and of what
// was already published, not of which commit changed what: a run that failed halfway is finished by the next push, or
// by re-running it, and a push that bumps nothing releases nothing.
//
// Every release is also a tag on the commit it was built from: `client-v<version>`, `cli-v<version>`, `ide-v<version>`.
// Release makes them only once every build and smoke test passed and the package is out, and never moves one. An npm
// version out without its tag (the tag failed after the publish) gets it from a later run, on the commit npm's
// provenance says it was built from.
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
    /** The prefix of the tag that marks a release of it, followed by the version: `cli-v1.2.3`. */
    readonly tagPrefix: string;
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
    { name: '@yukibana/client', manifest: 'packages/client/package.json', registry: 'npm', output: 'client', tagPrefix: 'client-v', needs: [] },
    { name: '@yukibana/cli', manifest: 'packages/cli/package.json', registry: 'npm', output: 'cli', tagPrefix: 'cli-v', needs: [] },
    { name: '@yukibana/ide-electron', manifest: 'ide/electron/package.json', registry: 'github', output: 'ide', tagPrefix: 'ide-v', needs: [] },
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
    /**
     * The versions of it that have their tag (`<tagPrefix><version>`), in any order. For the IDE, whose tag is made by
     * publishing its GitHub release and is what says it is out, the same as `published`.
     */
    readonly tagged: readonly string[];
}

/**
 * The tag a run makes for an npm package: `here` on the commit being released, for a version it publishes; `recover`
 * for the version in git when it is out but has no tag, on the commit it was built from (which only npm's provenance
 * knows).
 */
export type TagAction = 'here' | 'recover';

/** What one run releases. */
export interface Plan {
    /** The packages to release, in `RELEASABLE` order (so the client before the CLI), with their versions. */
    readonly release: readonly { readonly package: Releasable; readonly version: string }[];
    /** Why each other package is not released, one sentence each. */
    readonly skipped: readonly string[];
    /** Why the run must fail, one sentence each; when not empty, nothing may be released. */
    readonly refused: readonly string[];
    /** The tags of npm packages to make once everything is published, in `RELEASABLE` order. */
    readonly tags: readonly { readonly package: Releasable; readonly version: string; readonly action: TagAction }[];
}

/**
 * The tag to make for the npm package `o` at its version in git, given whether this run releases it; undefined when
 * there is none to make. Throws a sentence (a refusal) when the tag exists but npm does not have the version: the tag
 * would claim a release that is not out, and tags are never moved or made again.
 */
export function tagAction(o: Observed, releasing: boolean): TagAction | undefined {
    if (o.package.registry !== 'npm' || !isReleaseVersion(o.version)) {
        return undefined;
    }
    const tag = `${o.package.tagPrefix}${o.version}`;
    const out = o.published.includes(o.version);
    const tagged = o.tagged.includes(o.version);
    if (tagged && !out) {
        throw new Error(
            `the tag ${tag} exists but npm has no ${o.package.name} ${o.version}; a tag is made only after the publish, so find out how it got there (and bump the version) rather than publish under it`,
        );
    }
    if (releasing) {
        return 'here';
    }
    return out && !tagged ? 'recover' : undefined;
}

/**
 * The plan for these packages: each one's decision, and a refusal for a package released that needs a workspace package
 * which neither is out at its version in git nor is released with it; and the tags to make (see {@link tagAction}).
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
    const tags: { package: Releasable; version: string; action: TagAction }[] = [];
    for (const d of decisions) {
        try {
            const action = tagAction(d, d.decision.kind === 'release');
            if (action !== undefined) {
                tags.push({ package: d.package, version: d.version, action });
            }
        } catch (e) {
            refused.push(e instanceof Error ? e.message : String(e));
        }
    }
    return {
        release: decisions.filter(d => d.decision.kind === 'release').map(d => ({ package: d.package, version: d.version })),
        skipped: decisions.flatMap(d => (d.decision.kind === 'skip' ? [d.decision.reason] : [])),
        refused,
        tags,
    };
}

/**
 * The workflow outputs for a plan: for each package, `<output>` is `true` or `false` and `<output>-version` its version
 * in git, and for an npm package `<output>-tag` its {@link TagAction} or `none`, with `<output>-tag-commit` the commit
 * to tag for `recover` (from `recoveredCommits`, by package name); `npm` is `true` iff any npm package is released,
 * and `tags` iff any npm tag is to be made.
 */
export function outputs(observed: readonly Observed[], p: Plan, recoveredCommits: Readonly<Record<string, string>> = {}): Record<string, string> {
    const out: Record<string, string> = {};
    for (const o of observed) {
        out[o.package.output] = String(p.release.some(r => r.package.name === o.package.name));
        out[`${o.package.output}-version`] = o.version;
        if (o.package.registry === 'npm') {
            const tag = p.tags.find(t => t.package.name === o.package.name);
            out[`${o.package.output}-tag`] = tag?.action ?? 'none';
            out[`${o.package.output}-tag-commit`] = tag?.action === 'recover' ? (recoveredCommits[o.package.name] ?? '') : '';
        }
    }
    out['npm'] = String(p.release.some(r => r.package.registry === 'npm'));
    out['tags'] = String(p.tags.length > 0);
    return out;
}

/**
 * The commit of `repository` (`owner/name` on GitHub) that npm's provenance says a version was built from, given the
 * registry's answer for its attestations (`/-/npm/v1/attestations/<name>@<version>`); undefined when the answer holds
 * no SLSA provenance built from that repository, or no commit.
 */
export function provenanceCommit(attestations: unknown, repository: string): string | undefined {
    const list = field(attestations, 'attestations');
    if (!Array.isArray(list)) {
        return undefined;
    }
    const prefix = `git+https://github.com/${repository.toLowerCase()}@`;
    for (const entry of list) {
        const payload = field(field(field(entry, 'bundle'), 'dsseEnvelope'), 'payload');
        if (field(entry, 'predicateType') !== 'https://slsa.dev/provenance/v1' || typeof payload !== 'string') {
            continue;
        }
        let statement: unknown;
        try {
            statement = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
        } catch {
            continue;
        }
        const dependencies = field(field(field(statement, 'predicate'), 'buildDefinition'), 'resolvedDependencies');
        for (const dependency of Array.isArray(dependencies) ? dependencies : []) {
            const uri = field(dependency, 'uri');
            const commit = field(field(dependency, 'digest'), 'gitCommit');
            if (typeof uri === 'string' && uri.toLowerCase().startsWith(prefix) && typeof commit === 'string' && /^[0-9a-f]{40}$/.test(commit)) {
                return commit;
            }
        }
    }
    return undefined;
}

/** `value`'s own property `key`, when `value` is an object that has one; undefined otherwise. */
function field(value: unknown, key: string): unknown {
    return typeof value === 'object' && value !== null ? Object.getOwnPropertyDescriptor(value, key)?.value : undefined;
}

/** The commit npm's provenance gives for `name` at `version`, built from `repository`; undefined when there is none. */
async function npmProvenanceCommit(name: string, version: string, repository: string): Promise<string | undefined> {
    const response = await fetch(`https://registry.npmjs.org/-/npm/v1/attestations/${name.replace('/', '%2f')}@${version}`);
    if (response.status === 404) {
        return undefined;
    }
    if (!response.ok) {
        throw new Error(`the npm registry answered ${response.status} for the attestations of ${name} ${version}`);
    }
    return provenanceCommit(await response.json(), repository);
}

/** The versions of `prefix` tags in this clone (which must have fetched them): `cli-v1.2.3` gives `1.2.3`. */
function taggedVersions(prefix: string): string[] {
    return execFileSync('git', ['tag', '--list', `${prefix}*`], { encoding: 'utf8' })
        .split('\n')
        .filter(t => t.startsWith(prefix))
        .map(t => t.slice(prefix.length));
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
            if (p.registry === 'npm') {
                return { package: p, version, published: await npmVersions(p.name), tagged: taggedVersions(p.tagPrefix) };
            }
            const ide = ideVersions();
            return { package: p, version, published: ide, tagged: ide };
        }),
    );
    const p = plan(observed);
    const refused = [...p.refused];
    // The repository whose workflow publishes: GitHub Actions sets it; the canonical one when run by hand elsewhere.
    const repository = process.env['GITHUB_REPOSITORY'] ?? 'Yukibana-Ed/Yukibana';
    const recoveredCommits: Record<string, string> = {};
    for (const tag of p.tags.filter(t => t.action === 'recover')) {
        const commit = await npmProvenanceCommit(tag.package.name, tag.version, repository);
        if (commit === undefined) {
            refused.push(
                `${tag.package.name} ${tag.version} is on npm without its tag ${tag.package.tagPrefix}${tag.version}, and its npm provenance names no commit of ${repository}; tag that commit by hand`,
            );
        } else {
            recoveredCommits[tag.package.name] = commit;
            process.stdout.write(`tag ${tag.package.tagPrefix}${tag.version} on ${commit}, where npm's provenance says it was built\n`);
        }
    }
    for (const r of p.release) {
        process.stdout.write(`release ${r.package.name} ${r.version}\n`);
    }
    for (const s of p.skipped) {
        process.stdout.write(`skip: ${s}\n`);
    }
    for (const r of refused) {
        process.stderr.write(`::error::${r}\n`);
    }
    if (refused.length > 0) {
        process.exitCode = 1;
    } else if (process.env['GITHUB_OUTPUT'] !== undefined) {
        appendFileSync(
            process.env['GITHUB_OUTPUT'],
            Object.entries(outputs(observed, p, recoveredCommits))
                .map(([k, v]) => `${k}=${v}\n`)
                .join(''),
        );
    }
}
