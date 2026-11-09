/** Downloading submissions assembled with their release, in the browser.
 *
 *  A teacher grades a submission put back together with the release's
 *  teacher archive: the student's files, with the read-only and hidden
 *  ones taken from the teacher's (`@yukibana/client/assembly`, the same
 *  assembly `yukibana download --assemble` makes). It happens here, in the
 *  teacher's browser, and not in the Worker: the cloud transforms nothing,
 *  and a Workers free plan allows about 10 ms of CPU per request, where
 *  unpacking and repacking a project takes far more. The Worker only pipes
 *  the archives through (`?inline`), because a page cannot read a
 *  cross-origin redirect's answer from a bucket without CORS.
 *
 *  Browser only: it fetches, and saves a file through a link.
 */

import type { Assembly, Entry } from '@yukibana/client/assembly';
import type { ReleaseId, SubmissionId } from '../ids';

/** What a teacher should know about an assembly: `Assembly` without its
 *  entries, which are not kept once saved. */
export type AssemblyReport = Pick<Assembly, 'tampering' | 'unrestored' | 'overridden' | 'refused'>;

/** One submission to assemble, and whose it is. */
export interface ToAssemble {
    readonly submission: SubmissionId;
    /** The release to assemble with: the one the student started from, or
     *  the newest when that is unknown. A release of the submission's project. */
    readonly release: ReleaseId;
    readonly submittedAt: Date;
    /** Unique among a batch; with the three below, what the student's
     *  folder is named after (`folderNames`). */
    readonly key: string;
    readonly name: string;
    readonly githubLogin: string | null;
    readonly email: string | null;
}

/** What became of one submission: its report, or why there is none, in a
 *  sentence for the teacher. */
export type Outcome =
    | { readonly submission: SubmissionId; readonly ok: true; readonly report: AssemblyReport }
    | { readonly submission: SubmissionId; readonly ok: false; readonly name: string; readonly why: string };

/** How many submissions are fetched and assembled at once: enough to keep
 *  the network busy, few enough that a class's archives are not all in
 *  memory at the same moment. */
const AT_ONCE = 4;

/** Assembles `it` and saves it as `<slug>-<login>-<time>.tar.gz`, which
 *  unpacks into a folder of that name: the name a plain download of it has. */
export async function downloadOne(slug: string, it: ToAssemble): Promise<Outcome> {
    const lib = await library();
    const folder = lib.safeSegment(`${slug}-${it.githubLogin ?? 'student'}-${lib.stampOf(new Date(it.submittedAt).toISOString())}`);
    const [outcome] = await assembleAndSave(
        [it],
        () => folder,
        `${folder}.tar.gz`,
        () => {},
    );
    return outcome ?? { submission: it.submission, ok: false, name: it.name, why: 'Nothing was assembled.' };
}

/** Assembles every one of `items` and saves them as one
 *  `<slug>-submissions.tar.gz`, a folder per student named as `yukibana
 *  download` names them. `progress` hears how many are done after each. */
export async function downloadAll(slug: string, items: readonly ToAssemble[], progress: (done: number) => void): Promise<Outcome[]> {
    const lib = await library();
    const folders = lib.folderNames(items.map(i => ({ userId: i.key, fullName: i.name, githubLogin: i.githubLogin, email: i.email })));
    const root = `${slug}-submissions`;
    return assembleAndSave(items, it => `${root}/${folders.get(it.key) ?? lib.safeSegment(it.key)}`, `${root}.tar.gz`, progress);
}

// Loaded on first use, so the library is in neither every page's bundle
// nor the Worker's.
const library = () => import('@yukibana/client/assembly');

/** Fetches and assembles each of `items` into the folder `folderOf` names,
 *  and saves them all as `filename`. Each teacher archive is fetched once
 *  however many students started from it. A submission that cannot be
 *  fetched or assembled is left out and its outcome says why; nothing is
 *  saved when none could be. */
async function assembleAndSave(items: readonly ToAssemble[], folderOf: (it: ToAssemble) => string, filename: string, progress: (done: number) => void): Promise<Outcome[]> {
    const lib = await library();
    const teachers = new Map<ReleaseId, Promise<Uint8Array>>();
    const teacherOf = (r: ReleaseId): Promise<Uint8Array> => {
        const got = teachers.get(r) ?? bytesOf(`/api/releases/${r}/teacher?inline`, 'The teacher archive');
        teachers.set(r, got);
        return got;
    };
    const outcomes: Outcome[] = [];
    const entries: Entry[] = [];
    const queue = [...items];
    const work = async (): Promise<void> => {
        for (let it = queue.shift(); it !== undefined; it = queue.shift()) {
            try {
                const [sent, teacher] = await Promise.all([bytesOf(`/api/submissions/${it.submission}?inline`, 'The submission'), teacherOf(it.release)]);
                const made = await lib.assembleInto(folderOf(it), sent, teacher);
                if (!made.ok) throw new Error(`It could not be assembled: ${made.problem}.`);
                entries.push(...made.entries);
                const { tampering, unrestored, overridden, refused } = made.assembled.assembly;
                outcomes.push({ submission: it.submission, ok: true, report: { tampering, unrestored, overridden, refused } });
            } catch (e) {
                outcomes.push({ submission: it.submission, ok: false, name: it.name, why: e instanceof Error ? e.message : String(e) });
            }
            progress(outcomes.length);
        }
    };
    await Promise.all(Array.from({ length: Math.min(AT_ONCE, items.length) }, work));
    if (entries.length > 0) save(await lib.gzip(await lib.writeTar(entries)), filename);
    return outcomes;
}

async function bytesOf(url: string, what: string): Promise<Uint8Array> {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) {
        // SvelteKit's error bodies are `{ message }`; anything else says nothing useful.
        const said = await res
            .json()
            .then((b: unknown) => (typeof b === 'object' && b !== null && 'message' in b && typeof b.message === 'string' ? b.message : ''))
            .catch(() => '');
        throw new Error(`${what} could not be downloaded (${res.status}${said === '' ? '' : `: ${said}`}).`);
    }
    return new Uint8Array(await res.arrayBuffer());
}

function save(bytes: Uint8Array<ArrayBuffer>, filename: string): void {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/gzip' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    // The click has started the download by the time the event loop turns.
    setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** What `r` should tell a teacher, one short line per kind of finding, in
 *  the order they matter; empty when the student touched nothing protected. */
export function findings(r: AssemblyReport): string[] {
    const list = (paths: readonly string[]) => paths.join(', ');
    const unrestored = new Set(r.unrestored);
    const restored = (paths: readonly string[]) => paths.filter(p => !unrestored.has(p));
    const out: string[] = [];
    const changed = restored([...r.tampering.modified, ...r.tampering.deleted]);
    if (changed.length > 0) out.push(`Restored ${list(changed)}`);
    const added = restored(r.tampering.added);
    if (added.length > 0) out.push(`Removed ${list(added)}`);
    if (r.unrestored.length > 0) out.push(`Kept the student's ${list(r.unrestored)} (no longer protected)`);
    if (r.overridden.length > 0) out.push(`Replaced ${list(r.overridden)} with the release's`);
    if (r.refused.length > 0) out.push(`Removed symlinks ${list(r.refused)}`);
    return out;
}
