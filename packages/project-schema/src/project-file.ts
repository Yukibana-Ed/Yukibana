/** `yukibana.json` at whatever version it was written, read as the latest. What code acts on is `ProjectFile`; the
 *  version a file was written at matters only to what writes it back. */

import { format, type Read } from './versions.js';
import { PROJECT_FILE_STEPS, PROJECT_FILE_VERSIONS } from './migrations.js';
import { KINDS_V1, SCHEMA_URL_V1, type ProjectFileV1 } from './v1.js';
import { globsSchema } from './brands.js';

/** The file's name, at the project root, in the repository and in every starter. */
export const CONFIG_FILE = 'yukibana.json';

/** `yukibana.json` at the latest version, which is what every program acts on. */
export type ProjectFile = ProjectFileV1;

/** `yukibana.json` at any version this package reads, discriminated by `version`. */
export type AnyProjectFile = ProjectFileV1;

/** The latest version of `yukibana.json` this package reads. */
export const LATEST: (typeof PROJECT_FILE_VERSIONS)['length'] = PROJECT_FILE_VERSIONS.length;

/** What the latest version's `$schema` is, exactly. */
export const SCHEMA_URL = SCHEMA_URL_V1;

/** Every project kind the latest version knows. */
export const KINDS = KINDS_V1;
/** A project kind, one of `KINDS`. */
export type Kind = ProjectFile['kind'];

const projectFile = format(CONFIG_FILE, PROJECT_FILE_VERSIONS, PROJECT_FILE_STEPS);

/** Returns `text`, a `yukibana.json`, read at the version it names and migrated to the latest, or why it cannot be:
 *  not JSON, not an object, no `version`, a newer version (with both numbers), a version that never existed, or every
 *  field problem at its version. Never throws. */
export function parseProjectFile(text: string): Read<ProjectFile, AnyProjectFile> {
    return projectFile.read(text);
}

/**
 * What a folder without a `yukibana.json` opens with: everything shown and on, nothing hidden or read-only,
 * everything submitted to the registry. A literal of the latest version, so a program has one type to act on whether
 * or not the file exists.
 *
 * Its `kind` is the first of `KINDS` because the type needs one; nothing that reads it may act on its kind, since a
 * folder without the file was never built by Yukibana. The IDE, the only reader of a folder without the file, reads
 * only the settings. Shared, so a caller must not change it.
 */
export const NO_PROJECT_FILE: ProjectFile = {
    $schema: SCHEMA_URL,
    version: 1,
    kind: KINDS[0],
    hidden: globsSchema.parse([]),
    assignmentFile: 'ASSIGNMENT.md',
    features: { codeSuggestions: true, squiggles: true, codeLenses: true, ai: true },
    layout: { widgets: { files: true, search: true, vcs: true, debug: true, testing: true, outline: true, aiChat: true }, containers: {}, views: {} },
    openFiles: [],
    readOnly: globsSchema.parse([]),
    submission: {
        include: globsSchema.parse(['**']),
        exclude: globsSchema.parse([]),
        respectGitignore: true,
        target: 'cloud',
        filename: 'submission.tar.gz',
        maxBytes: 32 * 1024 * 1024,
    },
    telemetry: { liveTypingStats: false },
};
