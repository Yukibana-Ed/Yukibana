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
import { gunzip, gzip } from './lib/gzip.js';
import { readTar, writeTar, type Entry } from './lib/tar.js';

export { assemble, submissionRoot, tampered, type Assembled, type Assembly, type Tampering } from './lib/assemble.js';
export { readTar, writeTar, type Entry } from './lib/tar.js';
export { gunzip, gzip } from './lib/gzip.js';

/** The entries of the `.tar.gz` `bytes`; rejects when it is not gzip or
 *  not a tar inside. */
export async function readTarGz(bytes: Uint8Array): Promise<Entry[]> {
    if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) throw new Error('not a .tar.gz');
    return readTar(await gunzip(bytes));
}

/** A submission assembled with a release, as one `.tar.gz` to save. */
export type AssembledArchive =
    | {
          /** `true` iff the submission could be assembled. */
          readonly ok: true;
          /** The assembled project as a `.tar.gz`, everything inside the one
           *  folder `assembleArchives` was given, as a teacher archive is. */
          readonly archive: Uint8Array<ArrayBuffer>;
          /** What `assemble` found: tampering, restored and overridden paths. */
          readonly assembled: Extract<Assembled, { ok: true }>;
      }
    | {
          /** `true` iff the submission could be assembled. */
          readonly ok: false;
          /** Why it could not, in a sentence. */
          readonly problem: string;
      };

/** `assemble` from archives to an archive: `submission` (as the student
 *  sent it), `teacher` (the grading release's teacher archive) and, when
 *  the student started from another release, `base` (that release's
 *  teacher archive), all `.tar.gz`. The archive made unpacks into one
 *  folder, `folder`, so that unpacking it beside others never mixes two
 *  students' files.
 *
 *  An archive that cannot be read is a problem named after it, not a throw.
 *
 *  - Requires: `folder` is one path segment, without `/`. */
export async function assembleArchives(folder: string, submission: Uint8Array, teacher: Uint8Array, base: Uint8Array = teacher): Promise<AssembledArchive> {
    const read = async (bytes: Uint8Array, what: string): Promise<Entry[] | string> => {
        try {
            return await readTarGz(bytes);
        } catch (e) {
            return `the ${what} could not be read (${e instanceof Error ? e.message : String(e)})`;
        }
    };
    const s = await read(submission, 'submission');
    if (typeof s === 'string') return { ok: false, problem: s };
    const t = await read(teacher, 'teacher archive');
    if (typeof t === 'string') return { ok: false, problem: t };
    const b = base === teacher ? t : await read(base, 'teacher archive of the release the student started from');
    if (typeof b === 'string') return { ok: false, problem: b };
    const assembled = assemble(s, t, b);
    if (!assembled.ok) return assembled;
    const inFolder: Entry[] = [
        { path: folder, type: 'dir', mode: 0o755, mtime: Math.floor(Date.now() / 1000), data: new Uint8Array(0) },
        ...assembled.assembly.entries.map(e => ({ ...e, path: `${folder}/${e.path}` })),
    ];
    return { ok: true, assembled, archive: await gzip(await writeTar(inFolder)) };
}
