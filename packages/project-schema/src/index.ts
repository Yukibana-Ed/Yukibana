/** Every version of `yukibana.json` and `yukibana.release.json`: each read at its own version, strict, and migrated to
 *  the latest, with migrations the compiler checks. Browser-safe (no `node:` import, only `zod`), so the IDE's
 *  frontend, the Worker and the website can import it as well as the CLI. */

import { format, type Read } from './versions.js';
import { RELEASE_FILE_STEPS, RELEASE_FILE_VERSIONS } from './migrations.js';
import { RELEASE_FILE, type ReleaseFileV1 } from './release-file.js';

export { exact, type Checked, type Exactly, type Migration } from './exact.js';
export { globsSchema, projectIdSchema, releaseIdSchema, type Globs, type ProjectId, type ReleaseId } from './brands.js';
export { expectation, fieldOf, nameOf } from './issues.js';
export { describe, format, type AnyOf, type FieldIssue, type Format, type LatestOf, type Numbered, type Read, type ReadError, type Steps, type VersionSchema } from './versions.js';
export { KINDS_V1, projectFileV1, SCHEMA_URL_V1, type ProjectFileV1 } from './v1.js';
export { RELEASE_FILE, releaseFileV1, type ReleaseFileV1 } from './release-file.js';
export { PROJECT_FILE_VERSIONS, RELEASE_FILE_VERSIONS } from './migrations.js';
export { CONFIG_FILE, KINDS, LATEST, NO_PROJECT_FILE, parseProjectFile, SCHEMA_URL, type AnyProjectFile, type Kind, type ProjectFile } from './project-file.js';
export { SCHEMA_BASE, schemaFiles, schemaIndex, type SchemaFile, type SchemaIndexEntry } from './json-schema.js';

/** `yukibana.release.json` at the latest version. */
export type ReleaseFile = ReleaseFileV1;

/** The latest version of `yukibana.release.json` this package reads. */
export const RELEASE_FILE_LATEST: (typeof RELEASE_FILE_VERSIONS)['length'] = RELEASE_FILE_VERSIONS.length;

const releaseFile = format(RELEASE_FILE, RELEASE_FILE_VERSIONS, RELEASE_FILE_STEPS);

/** Returns `text`, a `yukibana.release.json`, read at the version it names and migrated to the latest, or why it
 *  cannot be, as `parseProjectFile` does. Never throws. */
export function parseReleaseFile(text: string): Read<ReleaseFile, ReleaseFileV1> {
    return releaseFile.read(text);
}
