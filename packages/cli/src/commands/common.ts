/** What every command shares: its options, how it fails, where the registry
 *  is, who is asking, and how a list is printed. */

import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { type SessionStore, tokenProvider, YukibanaClient } from '@yukibana/client';
import { CONFIG_FILE, parseConfig } from '@yukibana/client/config';
import { defaultSessionPath, fileStore } from '../store.js';

/** The options, as `parseArgs` reads them for every command. */
export interface Options {
    /** `--out`: where a command writes, a file or a directory as its usage says. */
    readonly out?: string | undefined;
    /** `--folder`: the directory a release's archives unpack into; the project directory's name when absent. */
    readonly folder?: string | undefined;
    /** `--label`: a release's label for people. */
    readonly label?: string | undefined;
    /** `--url`: the registry, before `YUKIBANA_URL` and the session's. */
    readonly url?: string | undefined;
    /** `--token`: a project token to publish with, before `YUKIBANA_TOKEN`. */
    readonly token?: string | undefined;
    /** `--project`: the project id, after a positional and before `YUKIBANA_PROJECT`. */
    readonly project?: string | undefined;
    /** `--edition`: the edition id `projects` and `members` are narrowed to. */
    readonly edition?: string | undefined;
    /** `--student-submissions`, repeatable: the authors whose submissions to take, as `select` matches them. */
    readonly 'student-submissions'?: readonly string[] | undefined;
    /** The old name of `--student-submissions`, still read so scripts keep
     *  working; it warns. */
    readonly student?: readonly string[] | undefined;
    /** `--submission`, repeatable: submission ids to take. */
    readonly submission?: readonly string[] | undefined;
    /** `--release`: the release to assemble with, an id or `newest`. */
    readonly release?: string | undefined;
    /** `--role`: the role `enrol` gives, `student` when absent. */
    readonly role?: string | undefined;
    /** `--teacher`: the teacher archive or directory `assemble` takes protected files from. */
    readonly teacher?: string | undefined;
    /** `--all-versions`: `true` iff `download` takes every submission, not only each author's newest. */
    readonly 'all-versions'?: boolean | undefined;
    /** `--latest`: `true` iff `submissions` lists only each author's newest. */
    readonly latest?: boolean | undefined;
    /** `--assemble`: `true` iff `download` assembles each submission with its release. */
    readonly assemble?: boolean | undefined;
    /** `--archive`: `true` iff `download` keeps each `.tar.gz` as sent instead of unpacking it. */
    readonly archive?: boolean | undefined;
    /** `--force`: `true` iff `download` and `assemble` replace a folder or file that is already there. */
    readonly force?: boolean | undefined;
    /** `--json`: `true` iff a list is printed as JSON, the whole objects, for scripts. */
    readonly json?: boolean | undefined;
    /** `--open`: `true` iff `projects` lists only those taking submissions now. */
    readonly open?: boolean | undefined;
    /** `--yes`: `true` iff `submit` sends without asking. */
    readonly yes?: boolean | undefined;
}

/** One run of a command: what it was given and where it keeps the session. */
export interface Invocation {
    /** The options given, whatever the command. */
    readonly options: Options;
    /** The positionals after the command. */
    readonly args: readonly string[];
    /** The environment the `YUKIBANA_*` variables are read from. */
    readonly env: NodeJS.ProcessEnv;
    /** Where the session lives; a test passes a memory store. */
    readonly store: SessionStore;
}

/** A command that cannot go on, with every reason. `index.ts` prints them
 *  and exits 1; nothing else in the commands exits. */
export class Failure extends Error {
    constructor(readonly lines: readonly string[]) {
        super(lines.join('\n'));
    }
}

/** Stops the command with `lines` as its reasons, by throwing a `Failure`. A function declaration, not an arrow
 *  function, so that TypeScript knows the code after a call is not reached. */
export function fail(...lines: string[]): never {
    throw new Failure(lines);
}

/** Returns the terminal's session store for `env`: the file `defaultSessionPath(env)` names. */
export function defaultStore(env: NodeJS.ProcessEnv): SessionStore {
    return fileStore(defaultSessionPath(env));
}

/** Returns the registry: `--url`, else `YUKIBANA_URL`, else the one logged in to. */
export async function registryUrl(inv: Invocation): Promise<string> {
    const url = inv.options.url ?? inv.env['YUKIBANA_URL'] ?? (await inv.store.load())?.url;
    if (url === undefined || url === '') fail('which registry? give --url, set YUKIBANA_URL, or log in first');
    return url;
}

/** Returns a client as the logged-in person. `YUKIBANA_ACCESS_TOKEN` stands in for a
 *  login where there is no browser, for a token got some other way. */
export async function clientFor(inv: Invocation): Promise<YukibanaClient> {
    return new YukibanaClient({ url: await registryUrl(inv), accessToken: accessTokenFor(inv) });
}

/** Returns the person's access token, as a function to ask before each request: `YUKIBANA_ACCESS_TOKEN` when set, else the
 *  stored session, refreshed as needed. */
export function accessTokenFor(inv: Invocation): () => Promise<string> {
    const fixed = inv.env['YUKIBANA_ACCESS_TOKEN'];
    return fixed !== undefined && fixed !== '' ? async () => fixed : tokenProvider(inv.store);
}

/** Returns the project a command is about: the first positional, else `--project`,
 *  else `YUKIBANA_PROJECT`, else the `projectId` in `dir`'s yukibana.json. */
export async function projectOf(inv: Invocation, positional: string | undefined, dir = '.'): Promise<string> {
    const given = positional ?? inv.options.project ?? inv.env['YUKIBANA_PROJECT'];
    if (given !== undefined && given !== '') return given;
    try {
        const parsed = parseConfig(await readFile(join(resolve(dir), CONFIG_FILE), 'utf8'));
        if (parsed.ok && parsed.config.projectId !== null) return parsed.config.projectId;
    } catch {
        // no file: fall through to the sentence below
    }
    return fail(`which project? give its id, or run this in a folder whose ${CONFIG_FILE} names one`);
}

/** Returns whose submissions `--student-submissions` asks for: names, logins,
 *  addresses or user ids, as `select` matches them. `--student`, its old
 *  name, still counts, with a warning: it read like a switch for "students
 *  only" rather than a filter by person. */
export function studentsOf(inv: Invocation): readonly string[] {
    const old = inv.options.student ?? [];
    if (old.length > 0) console.error('warning: --student is now --student-submissions; the old name will go');
    return [...(inv.options['student-submissions'] ?? []), ...old];
}

/** Prints rows as aligned columns, or as JSON with `--json` (the whole
 *  objects, for scripts). */
export function print<T>(inv: Invocation, rows: readonly T[], columns: Record<string, (row: T) => string>): void {
    if (inv.options.json === true) {
        console.log(JSON.stringify(rows, null, 2));
        return;
    }
    if (rows.length === 0) {
        console.log('(none)');
        return;
    }
    const heads = Object.keys(columns);
    const cells = rows.map(r => heads.map(h => (columns[h] ?? (() => ''))(r)));
    const widths = heads.map((h, i) => Math.max(h.length, ...cells.map(c => (c[i] ?? '').length)));
    const line = (c: readonly string[]): string =>
        c
            .map((s, i) => s.padEnd(widths[i] ?? 0))
            .join('  ')
            .trimEnd();
    console.log(line(heads));
    for (const c of cells) console.log(line(c));
}

/** Returns `iso` as a time for a person to read, in their zone (`2026-10-07 16:03`), or `-` for null. */
export function when(iso: string | null): string {
    if (iso === null) return '-';
    const d = new Date(iso);
    const pad = (n: number): string => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Returns `n` bytes as a size for a person to read, in B, KiB or MiB. */
export function bytes(n: number): string {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
    return `${(n / 1024 / 1024).toFixed(1)} MiB`;
}
