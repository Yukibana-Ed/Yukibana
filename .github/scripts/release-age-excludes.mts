/**
 * SPDX-License-Identifier: MIT
 */
// Fails while pnpm-workspace.yaml's minimumReleaseAgeExclude holds an entry that is no longer needed or not allowed.
// An exclusion lets a release younger than minimumReleaseAge in, which is only for a fix to a vulnerability that is
// being exploited (CONTRIBUTING.md). Each entry names one exact version, and once that version is older than the
// window it would be accepted anyway: then the entry is only a hole for later, and this check fails until it is removed.
//
//   node .github/scripts/release-age-excludes.mts
import { execFileSync } from 'node:child_process';

/** A `minimumReleaseAgeExclude` entry that names one exact version. */
export interface Exclusion {
    /** The package's name, with its scope if it has one. */
    readonly name: string;
    /** The exact version, `major.minor.patch` with an optional prerelease and build. */
    readonly version: string;
}

const EXACT = /^((?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*)@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/;

/** Returns the exclusion an entry names, or `undefined` if it is not one exact version (a name alone, a range, a glob). */
export function parseExclusion(entry: string): Exclusion | undefined {
    const match = EXACT.exec(entry);
    if (match === null) {
        return undefined;
    }
    const [, name, version] = match;
    return name === undefined || version === undefined ? undefined : { name, version };
}

/**
 * Returns what is wrong with one entry, or `undefined` if nothing is.
 *
 * @param published when the entry's version was published, as the registry's `time` field has it; `undefined` if the
 *   registry does not know the version.
 * @param minutes pnpm's `minimumReleaseAge`, in minutes.
 * - Requires: `minutes` is a non-negative integer.
 */
export function problemWith(entry: string, published: string | undefined, minutes: number, now: Date): string | undefined {
    if (!Number.isInteger(minutes) || minutes < 0) {
        throw new Error(`problemWith: minimumReleaseAge must be a non-negative integer of minutes, not ${minutes}`);
    }
    if (parseExclusion(entry) === undefined) {
        return `${entry}: not one exact version (name@1.2.3), so it would let in more than the release that was reviewed`;
    }
    if (published === undefined) {
        return `${entry}: the registry has no such version`;
    }
    const time = Date.parse(published);
    if (Number.isNaN(time)) {
        throw new Error(`problemWith: ${entry} has an unreadable publish time ${JSON.stringify(published)}`);
    }
    const accepted = new Date(time + minutes * 60_000);
    if (accepted <= now) {
        return `${entry}: published ${published}, so minimumReleaseAge accepts it since ${accepted.toISOString()}; remove the entry`;
    }
    return undefined;
}

/** Returns a pnpm setting of this workspace, parsed from `pnpm config get --json`. */
function setting(name: string): unknown {
    const out = execFileSync('pnpm', ['config', 'get', name, '--json'], { encoding: 'utf8' }).trim();
    return out === '' || out === 'undefined' ? undefined : JSON.parse(out);
}

/** Returns when the registry says this version was published, or `undefined` if it does not know it. */
async function publishTime(registry: string, { name, version }: Exclusion): Promise<string | undefined> {
    const url = new URL(name.replace('/', '%2f'), registry.endsWith('/') ? registry : `${registry}/`);
    const response = await fetch(url, { headers: { accept: 'application/json' } });
    if (response.status === 404) {
        return undefined;
    }
    if (!response.ok) {
        throw new Error(`${url.href}: HTTP ${response.status}`);
    }
    const body: unknown = await response.json();
    if (typeof body !== 'object' || body === null || !('time' in body) || typeof body.time !== 'object' || body.time === null) {
        throw new Error(`${url.href}: the registry's answer has no time field`);
    }
    const time: unknown = (body.time as Record<string, unknown>)[version];
    return typeof time === 'string' ? time : undefined;
}

if (import.meta.main) {
    const minutes = setting('minimumReleaseAge');
    const entries = setting('minimumReleaseAgeExclude') ?? [];
    const registry = setting('registry') ?? 'https://registry.npmjs.org/';
    if (typeof minutes !== 'number' || !Array.isArray(entries) || !entries.every(e => typeof e === 'string') || typeof registry !== 'string') {
        throw new Error(`unexpected pnpm settings: minimumReleaseAge ${JSON.stringify(minutes)}, minimumReleaseAgeExclude ${JSON.stringify(entries)}`);
    }
    const now = new Date();
    const problems: string[] = [];
    for (const entry of entries) {
        const exclusion = parseExclusion(entry);
        const problem = problemWith(entry, exclusion === undefined ? undefined : await publishTime(registry, exclusion), minutes, now);
        if (problem !== undefined) {
            problems.push(problem);
        }
    }
    if (problems.length > 0) {
        console.error(`minimumReleaseAgeExclude in pnpm-workspace.yaml:\n${problems.map(p => `  ${p}`).join('\n')}`);
        process.exit(1);
    }
    console.log(`minimumReleaseAgeExclude: ${entries.length === 0 ? 'empty' : `${entries.length} entries, each still younger than ${minutes} minutes`}`);
}
