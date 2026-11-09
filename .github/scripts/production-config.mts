/**
 * SPDX-License-Identifier: MIT
 */
// Fails when a production value is still a placeholder, naming every one and where it comes from. Deploy cloud runs
// this before anything else: a Worker deployed with REPLACE_ME_PROJECT_REF in it would start, serve pages, and fail
// every login with something that looks nothing like the cause. A placeholder left means nobody has pointed the
// repository at an environment yet, so the workflow then deploys nothing and says so.
//
//   node .github/scripts/production-config.mts     # from the repository root
import { readFileSync } from 'node:fs';

/** What each placeholder stands for, so that the message says where to find its value. */
export const PLACEHOLDERS = {
    REPLACE_ME_PROJECT_REF: "the Supabase project ref: the first label of the project's API URL, https://<ref>.supabase.co",
    REPLACE_ME_HYPERDRIVE_ID: 'the Hyperdrive id printed by `wrangler hyperdrive create yukibana-cloud --connection-string=...`',
    REPLACE_ME_WORKERS_SUBDOMAIN: 'the workers.dev subdomain, or the custom domain the app is served on',
} as const;

/** The name of a placeholder. */
export type Placeholder = keyof typeof PLACEHOLDERS;

/** The files that hold production values, relative to the repository root. */
export const PRODUCTION_FILES: readonly string[] = ['cloud/web/wrangler.jsonc', 'cloud/db/supabase/config.toml'];

/** One placeholder left in a file. */
export interface Found {
    /** The placeholder's name. */
    readonly name: Placeholder;
    /** The file it is in, as given to `placeholdersIn`. */
    readonly file: string;
    /** The 1-based number of the line it is on. */
    readonly line: number;
}

/** Returns every placeholder left in these files, given as their path and text, in file then line order. */
export function placeholdersIn(files: readonly { readonly file: string; readonly text: string }[]): Found[] {
    const names = Object.keys(PLACEHOLDERS) as Placeholder[];
    return files.flatMap(({ file, text }) => text.split('\n').flatMap((content, i) => names.filter(name => content.includes(name)).map(name => ({ name, file, line: i + 1 }))));
}

/**
 * Returns the message that names each placeholder left, what it stands for and where it is.
 *
 * - Requires: `found` is not empty (throws otherwise).
 */
export function report(found: readonly Found[]): string {
    if (found.length === 0) {
        throw new Error('report: no placeholder is left, so there is nothing to report');
    }
    const names = [...new Set(found.map(f => f.name))];
    const sections = names.map(name => [`  ${name}`, `    is ${PLACEHOLDERS[name]}`, ...found.filter(f => f.name === name).map(f => `    at ${f.file}:${f.line}`), ''].join('\n'));
    return ['These production values are still placeholders:', '', ...sections, 'Fill them in and commit; docs/cloud/deploy.md says where each comes from.', ''].join('\n');
}

if (import.meta.main) {
    const found = placeholdersIn(PRODUCTION_FILES.map(file => ({ file, text: readFileSync(file, 'utf8') })));
    if (found.length === 0) {
        process.stdout.write('production configuration has no placeholders left\n');
    } else {
        process.stderr.write(report(found));
        process.exitCode = 1;
    }
}
