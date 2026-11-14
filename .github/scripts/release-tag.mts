// Checks the tag a Release run was started with (Actions, Release, Run workflow): what it releases, at which version,
// and that the run may release it. Release runs it before anything builds and again before it publishes, so that a
// re-run of an old run never publishes after a newer release.
//
//   RELEASE_TAG=cli-v1.2.3 node .github/scripts/release-tag.mts   # from the repository root; writes GITHUB_OUTPUT if set
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';

/** What Release can release, by the prefix of its tag (`<kind>-v<version>`): the package's name and folder. */
export const PACKAGES = {
    client: { name: '@yukibana/client', dir: 'packages/client' },
    cli: { name: '@yukibana/cli', dir: 'packages/cli' },
    ide: { name: '@yukibana/ide-electron', dir: 'ide/electron' },
} as const;

/** Which package a tag releases. */
export type Kind = keyof typeof PACKAGES;

/** A version Release may publish, `X.Y.Z` with no leading zeros and no prerelease part. */
const RELEASE_VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

/** The tags of the IDE releases made by hand before this workflow, `v0.1.0` and `v0.2.0`, which count as IDE versions. */
const LEGACY_IDE_TAG = /^v(.*)$/;

/** Whether `value` names a package Release knows. */
function isKind(value: string | undefined): value is Kind {
    return value !== undefined && Object.hasOwn(PACKAGES, value);
}

/** The package and version of a release tag, `<kind>-v<X.Y.Z>`; undefined for anything else. */
export function parseTag(tag: string): { kind: Kind; version: string } | undefined {
    const match = /^([a-z]+)-v(.*)$/.exec(tag);
    const kind = match?.[1];
    const version = match?.[2];
    if (!isKind(kind) || version === undefined || !RELEASE_VERSION.test(version)) {
        return undefined;
    }
    return { kind, version };
}

/**
 * Returns a negative number, zero or a positive number as `a` is lower than, equal to or higher than `b`.
 *
 * - Requires: both are `X.Y.Z`.
 */
export function compareVersions(a: string, b: string): number {
    const [x, y] = [a.split('.').map(Number), b.split('.').map(Number)];
    for (let i = 0; i < 3; i++) {
        const d = (x[i] ?? 0) - (y[i] ?? 0);
        if (d !== 0) {
            return d;
        }
    }
    return 0;
}

/** The versions of `kind` released, from the repository's tag names: its own, and for the IDE the old `v` ones. */
export function releasedVersions(kind: Kind, tags: Iterable<string>): string[] {
    return [...tags].flatMap(tag => {
        const parsed = parseTag(tag);
        if (parsed) {
            return parsed.kind === kind ? [parsed.version] : [];
        }
        const legacy = kind === 'ide' ? LEGACY_IDE_TAG.exec(tag)?.[1] : undefined;
        return legacy !== undefined && RELEASE_VERSION.test(legacy) ? [legacy] : [];
    });
}

/**
 * Whether a run building `commit` may release `tag`, given the repository's tags (name to the commit each is on). It may
 * when `tag` is a release tag that does not exist yet, or is on `commit` already (an earlier attempt of the same release,
 * which the run finishes), and no release of the same package is as high or higher: a version is used once, and npm's
 * `latest` and the IDE's updater only go forward. Tags are never moved, so every published version has its tag, and the
 * tags alone say what is out.
 */
export function check(tag: string, tags: ReadonlyMap<string, string>, commit: string): { ok: true; kind: Kind; version: string } | { ok: false; reason: string } {
    const parsed = parseTag(tag);
    if (!parsed) {
        return { ok: false, reason: `${JSON.stringify(tag)} is not a release tag: client-vX.Y.Z, cli-vX.Y.Z or ide-vX.Y.Z` };
    }
    const on = tags.get(tag);
    if (on !== undefined && on !== commit) {
        return { ok: false, reason: `${tag} is released already, from ${on}; a version is used once, so release the next one` };
    }
    const others = [...tags.keys()].filter(t => t !== tag);
    const newest = releasedVersions(parsed.kind, others).toSorted(compareVersions).at(-1);
    if (newest !== undefined && compareVersions(parsed.version, newest) <= 0) {
        return { ok: false, reason: `${tag} is not higher than ${newest}, the newest ${parsed.kind} release; a release only goes forward` };
    }
    return { ok: true, ...parsed };
}

if (import.meta.main) {
    const tag = process.env['RELEASE_TAG'] ?? '';
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const tags = new Map(
        execFileSync('git', ['for-each-ref', '--format=%(refname:short) %(*objectname) %(objectname)', 'refs/tags'], { encoding: 'utf8' })
            .split('\n')
            .filter(line => line !== '')
            .map(line => {
                // An annotated tag's commit is %(*objectname); a lightweight tag's is %(objectname), and its %(*objectname) is empty.
                const [name = '', peeled = '', object = ''] = line.split(' ');
                return [name, peeled || object] as const;
            }),
    );
    const result = check(tag, tags, commit);
    if (!result.ok) {
        process.stderr.write(`::error::${result.reason}\n`);
        process.exitCode = 1;
    } else {
        const { name, dir } = PACKAGES[result.kind];
        process.stdout.write(`release ${name} ${result.version} as ${tag} from ${commit}\n`);
        if (process.env['GITHUB_OUTPUT'] !== undefined) {
            appendFileSync(process.env['GITHUB_OUTPUT'], `kind=${result.kind}\nversion=${result.version}\nname=${name}\ndir=${dir}\n`);
        }
    }
}
