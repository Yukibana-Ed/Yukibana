/** The JSON Schema of every version of both files, as `schemas/` holds them and the website serves them: an editor
 *  checks a `yukibana.json` against the version its `$schema` names. Generated from the zod schemas, so the two cannot
 *  disagree about a field; `tests/json-schema.test.ts` fails when a committed file is not what this generates, and
 *  never rewrites a released version's file (`released.json`).
 *
 *  A JSON Schema states less than the zod schema: the refinements (a glob relative to the root, a file name without a
 *  directory) have no JSON form and are left out, so an editor accepts some files the IDE refuses, and never the other
 *  way round. An id's shape is a regex, which does have one, and is kept. */

import * as z from 'zod';
import { PROJECT_FILE_VERSIONS, RELEASE_FILE_VERSIONS } from './migrations.js';
import { CONFIG_FILE } from './project-file.js';
import { RELEASE_FILE } from './release-file.js';

/** Where the website serves every file of `schemas/`: `schemas/<path>` is `<SCHEMA_BASE>/<path>`. */
export const SCHEMA_BASE = 'https://yukibana.dev/schema';

/** One generated JSON Schema file. */
export interface SchemaFile {
    /** Which format it is a version of, and the directory under `schemas/` and under `SCHEMA_BASE` it lives in. */
    readonly format: 'yukibana' | 'yukibana-release';
    /** The version it describes, from 1. */
    readonly version: number;
    /** Its path under `schemas/` and under `SCHEMA_BASE`: `yukibana/v1.json`. */
    readonly path: string;
    /** Its contents, as the committed file holds them: two-space JSON and a final newline. */
    readonly text: string;
}

/** Returns `schema` as a draft 2020-12 JSON Schema whose `$id` is `id` and whose `title` is `title`. */
function generate(schema: z.ZodType, id: string, title: string): string {
    const generated = z.toJSONSchema(schema, { io: 'input', target: 'draft-2020-12' }) as Record<string, unknown>;
    return `${JSON.stringify({ $schema: generated['$schema'], $id: id, title, ...generated }, null, 2)}\n`;
}

/** One entry of `schemas/index.json`, the list the website's build fetches the files by. */
export interface SchemaIndexEntry {
    /** The file's path under `schemas/` and under `SCHEMA_BASE`. */
    readonly path: string;
    /** `true` iff `released.json` lists its version: the file never changes again, and may be cached forever. */
    readonly released: boolean;
}

/** Returns `schemas/index.json` as the committed file holds it: every file of `files`, oldest first, with whether
 *  `released` (the contents of `released.json`) lists its version. It is how a reader that cannot list a directory
 *  (the website's build, which fetches the files of one commit over HTTPS) finds them. */
export function schemaIndex(files: readonly SchemaFile[], released: Readonly<Record<SchemaFile['format'], readonly number[]>>): string {
    const entries: SchemaIndexEntry[] = files.map(f => ({ path: f.path, released: released[f.format].includes(f.version) }));
    return `${JSON.stringify(entries, null, 2)}\n`;
}

/** Returns every version's JSON Schema of `yukibana.json` and of `yukibana.release.json`, oldest first. */
export function schemaFiles(): readonly SchemaFile[] {
    const files = (format: SchemaFile['format'], title: string, versions: readonly z.ZodType[]): SchemaFile[] =>
        versions.map((schema, i) => {
            const path = `${format}/v${i + 1}.json`;
            return { format, version: i + 1, path, text: generate(schema, `${SCHEMA_BASE}/${path}`, title) };
        });
    return [...files('yukibana', CONFIG_FILE, PROJECT_FILE_VERSIONS), ...files('yukibana-release', RELEASE_FILE, RELEASE_FILE_VERSIONS)];
}
