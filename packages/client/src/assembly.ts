/** `@yukibana/client/assembly`: a submission put back together with a
 *  release's teacher archive, from bytes to bytes.
 *
 *  Pure and browser-safe, like `@yukibana/client/config`: it imports
 *  modern-tar, zod and no Node module, so the registry's staff page can
 *  assemble a submission in the teacher's browser, where the work belongs.
 *  The registry's Worker transforms nothing (a Workers free plan allows
 *  about 10 ms of CPU per request; docs/cloud/architecture.md). The root
 *  entry's `assemble` is the same function; the CLI and the IDE take it
 *  from there.
 */

import { assemble, type Assembled } from './lib/assemble.js';
import { gunzip } from './lib/gzip.js';
import { readTar, type Entry } from './lib/tar.js';

export type { Assembly, Tampering } from './lib/assemble.js';
export { writeTar, type Entry } from './lib/tar.js';
export { gzip } from './lib/gzip.js';
export { folderNames, safeSegment, stampOf } from './lib/names.js';

/** A submission assembled with a release, as entries inside one folder. */
export type AssembledEntries =
    | {
          /** `true` iff the submission could be assembled. */
          readonly ok: true;
          /** The assembled project inside `folder`: the folder first, then
           *  every entry of the assembly under it. */
          readonly entries: readonly Entry[];
          /** What `assemble` found: tampering, restored and overridden paths. */
          readonly assembled: Extract<Assembled, { ok: true }>;
      }
    | {
          /** `true` iff the submission could be assembled. */
          readonly ok: false;
          /** Why it could not, in a sentence. */
          readonly problem: string;
      };

/** `assemble` from archives: `submission` (as the student sent it) with
 *  `teacher`, the teacher archive of the release they started from, both
 *  `.tar.gz`. The entries are under `folder`, so that several students'
 *  assemblies can share one archive without mixing their files.
 *
 *  An archive that cannot be read is a problem named after it, not a throw.
 *
 *  - Requires: `folder` is a relative path without `..` or a trailing `/`. */
export async function assembleInto(folder: string, submission: Uint8Array, teacher: Uint8Array): Promise<AssembledEntries> {
    const read = async (bytes: Uint8Array, what: string): Promise<Entry[] | string> => {
        try {
            if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) throw new Error('not a .tar.gz');
            return await readTar(await gunzip(bytes));
        } catch (e) {
            return `the ${what} could not be read (${e instanceof Error ? e.message : String(e)})`;
        }
    };
    const s = await read(submission, 'submission');
    if (typeof s === 'string') return { ok: false, problem: s };
    const t = await read(teacher, 'teacher archive');
    if (typeof t === 'string') return { ok: false, problem: t };
    const assembled = assemble(s, t);
    if (!assembled.ok) return assembled;
    const entries: Entry[] = [
        { path: folder, type: 'dir', mode: 0o755, mtime: Math.floor(Date.now() / 1000), data: new Uint8Array(0) },
        ...assembled.assembly.entries.map(e => ({ ...e, path: `${folder}/${e.path}` })),
    ];
    return { ok: true, assembled, entries };
}
