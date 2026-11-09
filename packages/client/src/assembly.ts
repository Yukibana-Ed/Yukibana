/** `@yukibana/client/assembly`: a submission put back together with a
 *  release's teacher archive, for a browser.
 *
 *  Pure and browser-safe, like `@yukibana/client/config`: it imports
 *  modern-tar, zod and no Node module, so the registry's staff page can
 *  assemble a submission in the teacher's browser. The registry's Worker
 *  transforms nothing (a Workers free plan allows about 10 ms of CPU per
 *  request; docs/cloud/architecture.md). `assembleSubmission` is the step
 *  `yukibana download --assemble` takes for each submission, so the page
 *  and the CLI choose the same releases and assemble the same files; each
 *  only fetches and saves in its own way.
 */

export { assembleSubmission, type Graded, type ReleaseRef } from './lib/grading.js';
export type { Assembly, Tampering } from './lib/assemble.js';
export { readArchive, writeTar, type Entry } from './lib/tar.js';
export { gzip } from './lib/gzip.js';
export { folderNames, safeSegment, stampOf } from './lib/names.js';
