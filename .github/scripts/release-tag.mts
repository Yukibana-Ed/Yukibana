// Checks the tag a Release run was started with (Actions, Release, Run workflow), before anything builds: what it
// releases, at which version, and that the version is new and goes forward. Release builds, smoke-tests and publishes
// that one package, and makes the tag only once that succeeded.
//
//   RELEASE_TAG=cli-v1.2.3 node .github/scripts/release-tag.mts   # from the repository root; writes GITHUB_OUTPUT if set
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

/** What Release can release, by the prefix of its tag (`<kind>-v<version>`). */
export const PACKAGES = {
    client: { name: '@yukibana/client', dir: 'packages/client', registry: 'npm' },
    cli: { name: '@yukibana/cli', dir: 'packages/cli', registry: 'npm' },
    ide: { name: '@yukibana/ide-electron', dir: 'ide/electron', registry: 'github' },
} as const;

/** Which package a tag releases. */
export type Kind = keyof typeof PACKAGES;

/** A version Release may publish, `X.Y.Z` with no leading zeros and no prerelease part. */
const RELEASE_VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

/** The tags of the IDE releases made by hand before this workflow, `v0.1.0` and `v0.2.0`, which count as IDE versions. */
const LEGACY_IDE_TAG = /^v(.*)$/;

/** The package and version of a release tag, `<kind>-v<X.Y.Z>`; undefined for anything else. */
export function parseTag(tag: string): { kind: Kind; version: string } | undefined {
    const match = /^(client|cli|ide)-v(.*)$/.exec(tag);
    const kind = match?.[1];
    const version = match?.[2];
    if (!isKind(kind) || version === undefined || !RELEASE_VERSION.test(version)) {
        return undefined;
    }
    return { kind, version };
}

/** Whether `value` names a package Release knows. */
function isKind(value: string | undefined): value is Kind {
    return value === 'client' || value === 'cli' || value === 'ide';
}

/**
 * Returns a negative number, zero or a positive number as `a` is lower than, equal to or higher than `b`.
 *
 * - Requires: both are `X.Y.Z`; throws otherwise.
 */
export function compareVersions(a: string, b: string): number {
    const parts = (v: string): number[] => {
        if (!RELEASE_VERSION.test(v)) {
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

/** The versions of `kind` released so far, from the repository's `tags`: its own, and for the IDE the old `v` ones. */
export function releasedVersions(kind: Kind, tags: readonly string[]): string[] {
    return tags.flatMap(tag => {
        const parsed = parseTag(tag);
        if (parsed) {
            return parsed.kind === kind ? [parsed.version] : [];
        }
        const legacy = kind === 'ide' ? LEGACY_IDE_TAG.exec(tag)?.[1] : undefined;
        return legacy !== undefined && RELEASE_VERSION.test(legacy) ? [legacy] : [];
    });
}

/**
 * Whether `tag` may be released, given the repository's `tags` and, for an npm package, the versions npm has. A release
 * tag that does not exist yet, whose version npm does not have and which is higher than every version of that package
 * released: a version is used once, and npm's `latest` and the IDE's updater only go forward.
 */
export function check(tag: string, tags: readonly string[], onNpm: readonly string[]): { ok: true; kind: Kind; version: string } | { ok: false; reason: string } {
    const parsed = parseTag(tag);
    if (!parsed) {
        return { ok: false, reason: `${JSON.stringify(tag)} is not a release tag: client-vX.Y.Z, cli-vX.Y.Z or ide-vX.Y.Z` };
    }
    if (tags.includes(tag)) {
        return { ok: false, reason: `${tag} exists already; a version is released once` };
    }
    if (onNpm.includes(parsed.version)) {
        return {
            ok: false,
            reason: `npm has ${PACKAGES[parsed.kind].name} ${parsed.version} but there is no tag ${tag}: re-run the failed jobs of the run that published it, which then only tags`,
        };
    }
    const newest = releasedVersions(parsed.kind, tags).toSorted(compareVersions).at(-1);
    if (newest !== undefined && compareVersions(parsed.version, newest) <= 0) {
        return { ok: false, reason: `${tag} is not higher than ${newest}, the newest ${parsed.kind} release; a release only goes forward` };
    }
    return { ok: true, ...parsed };
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

if (import.meta.main) {
    const tag = process.env['RELEASE_TAG'] ?? '';
    const tags = execFileSync('git', ['tag', '--list'], { encoding: 'utf8' })
        .split('\n')
        .filter(t => t !== '');
    const parsed = parseTag(tag);
    const pkg = parsed ? PACKAGES[parsed.kind] : undefined;
    const result = check(tag, tags, pkg?.registry === 'npm' ? await npmVersions(pkg.name) : []);
    if (!result.ok) {
        process.stderr.write(`::error::${result.reason}\n`);
        process.exitCode = 1;
    } else {
        const { name, dir } = PACKAGES[result.kind];
        process.stdout.write(`release ${name} ${result.version} as ${tag}\n`);
        if (process.env['GITHUB_OUTPUT'] !== undefined) {
            appendFileSync(process.env['GITHUB_OUTPUT'], `kind=${result.kind}\nversion=${result.version}\nname=${name}\ndir=${dir}\n`);
        }
    }
}
