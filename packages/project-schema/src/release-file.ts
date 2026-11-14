/** `yukibana.release.json`: which registry project and release a starter is. `yukibana build` and `publish` write it
 *  into the starter, beside the teacher's `yukibana.json`, which therefore says nothing about any one release; a course
 *  repository has none. A student can edit it, so to the registry it is a claim: a submission's release id is kept
 *  only when it names a release of the same project. */

import * as z from 'zod';
import { projectIdSchema, releaseIdSchema } from './brands.js';

/** The file's name, at the root of a starter. */
export const RELEASE_FILE = 'yukibana.release.json';

/** Version 1 of `yukibana.release.json`, strict: exactly these three fields. It has no `$schema`, because nobody
 *  writes it by hand. */
export const releaseFileV1 = z
    .strictObject({
        version: z.literal(1).describe('The shape of this file: 1.'),
        projectId: projectIdSchema.describe('The registry project a submission from this folder goes to.'),
        releaseId: releaseIdSchema.describe(
            'The release this starter is, chosen by yukibana build before the upload so the release row has the same id. A submission sends it, so grading compares the read-only files with that release.',
        ),
    })
    .describe("Which registry project and release a starter is. Written by yukibana build and publish into the starter's root; a course repository has none.");

/** A `yukibana.release.json` at version 1, as parsed. */
export type ReleaseFileV1 = z.output<typeof releaseFileV1>;
