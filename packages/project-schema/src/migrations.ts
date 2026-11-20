/** The steps between the versions of `yukibana.json` and of `yukibana.release.json`, in order: step `N` takes a file
 *  at version `N` to version `N + 1`, and must return through `exact` (`Migration`), so a key the next version does
 *  not have cannot ride along in a spread. Each step is written once and never changed after its target version is
 *  released, like the schemas.
 *
 *  Empty while version 1 is the only one. The second version adds `projectFileV2` to `PROJECT_FILE_VERSIONS` and its
 *  step here, `fromV1: Migration<ProjectFileV1, ProjectFileV2>`, and the compiler refuses the chain until the two
 *  agree. `tests/versions.test.ts` builds such a chain with a test-only version 2. */

import type { Steps } from './versions.js';
import { projectFileV1 } from './v1.js';
import { releaseFileV1 } from './release-file.js';

/** Every version of `yukibana.json`, version `N` at index `N - 1`. */
export const PROJECT_FILE_VERSIONS = [projectFileV1] as const;

/** The steps between `PROJECT_FILE_VERSIONS`. */
export const PROJECT_FILE_STEPS: Steps<typeof PROJECT_FILE_VERSIONS> = [];

/** Every version of `yukibana.release.json`, version `N` at index `N - 1`. */
export const RELEASE_FILE_VERSIONS = [releaseFileV1] as const;

/** The steps between `RELEASE_FILE_VERSIONS`. */
export const RELEASE_FILE_STEPS: Steps<typeof RELEASE_FILE_VERSIONS> = [];
