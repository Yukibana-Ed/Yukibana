/** Downloading submissions assembled for grading, in the browser.
 *
 *  The assembly is `assembleSubmission` from `@yukibana/client/assembly`,
 *  the very step `yukibana download --assemble` takes: the same choice of
 *  release (the one the registry recorded, else the one the archive's
 *  yukibana.json names, else the newest) and the same files. What is here
 *  is only the browser's half: fetching, packing the result into one file,
 *  and the words a teacher reads. The CLI's half (disk, terminal) is in
 *  `packages/cli/src/commands/collect.ts`; the two loops look alike because
 *  they do the same thing to different I/O, and sharing them would mean
 *  abstracting the I/O, which is all they are.
 *
 *  It happens in the teacher's browser, not the Worker: the cloud
 *  transforms nothing, and a Workers free plan allows about 10 ms of CPU
 *  per request. The Worker only pipes the archives through (`?inline`),
 *  because a page cannot read a cross-origin redirect's answer from a
 *  bucket without CORS.
 */

import type { Assembly, Entry } from '@yukibana/client/assembly';
import type { Release } from '../hand-ins';
import type { ReleaseId, SubmissionId } from '../ids';

/** What a teacher should know about an assembly: `Assembly` without its
 *  entries, which are not kept once saved. */
export type AssemblyReport = Pick<Assembly, 'tampering' | 'unrestored' | 'overridden' | 'refused'>;

/** One submission to assemble, and whose it is. */
export interface ToAssemble {
    readonly submission: SubmissionId;
    /** The release the registry recorded it as started from, or null. */
    readonly recorded: ReleaseId | null;
    readonly submittedAt: Date;
    /** Unique among a batch; with the three below, what the student's
     *  folder is named after (`folderNames`). */
    readonly key: string;
    readonly name: string;
    readonly githubLogin: string | null;
    readonly email: string | null;
}

/** What became of one submission: its report and notes, or why there is
 *  none, in a sentence for the teacher. */
export type Outcome =
    | { readonly submission: SubmissionId; readonly ok: true; readonly report: AssemblyReport; readonly notes: readonly string[] }
    | { readonly submission: SubmissionId; readonly ok: false; readonly name: string; readonly why: string };

/** How many submissions are fetched and assembled at once: enough to keep
 *  the network busy, few enough that a class's archives are not all in
 *  memory at the same moment. */
const AT_ONCE = 4;

/** Assembles `it` with one of `releases` (the project's, newest first)
 *  and saves it as `<slug>-<login>-<time>.tar.gz`, unpacking into a folder
 *  of that name. */
export async function downloadOne(slug: string, releases: readonly Release[], it: ToAssemble): Promise<Outcome> {
    const lib = await library();
    const folder = lib.safeSegment(`${slug}-${it.githubLogin ?? 'student'}-${lib.stampOf(new Date(it.submittedAt).toISOString())}`);
    const [outcome] = await assembleAndSave(
        releases,
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
export async function downloadAll(slug: string, releases: readonly Release[], items: readonly ToAssemble[], progress: (done: number) => void): Promise<Outcome[]> {
    const lib = await library();
    const folders = lib.folderNames(items.map(i => ({ userId: i.key, fullName: i.name, githubLogin: i.githubLogin, email: i.email })));
    const root = `${slug}-submissions`;
    return assembleAndSave(releases, items, it => `${root}/${folders.get(it.key) ?? lib.safeSegment(it.key)}`, `${root}.tar.gz`, progress);
}

// Loaded on first use, so the library is in neither every page's bundle
// nor the Worker's.
const library = () => import('@yukibana/client/assembly');

/** Fetches and assembles each of `items` into the folder `folderOf` names,
 *  and saves them all as `filename`. Each teacher archive is fetched and
 *  read once however many students need it. A submission that cannot be
 *  fetched or assembled is left out and its outcome says why; nothing is
 *  saved when none could be.
 *
 *  - Requires: `releases` is not empty. */
async function assembleAndSave(
    releases: readonly Release[],
    items: readonly ToAssemble[],
    folderOf: (it: ToAssemble) => string,
    filename: string,
    progress: (done: number) => void,
): Promise<Outcome[]> {
    const lib = await library();
    const teachers = new Map<string, Promise<Entry[]>>();
    const teacherOf = (r: Release): Promise<Entry[]> => {
        const got = teachers.get(r.releaseId) ?? bytesOf(`/api/releases/${r.releaseId}/teacher?inline`, 'The teacher archive').then(lib.readArchive);
        teachers.set(r.releaseId, got);
        return got;
    };
    const outcomes: Outcome[] = [];
    const entries: Entry[] = [];
    const queue = [...items];
    const work = async (): Promise<void> => {
        for (let it = queue.shift(); it !== undefined; it = queue.shift()) {
            try {
                const sent = await bytesOf(`/api/submissions/${it.submission}?inline`, 'The submission');
                const made = await lib.assembleSubmission(sent, releases, 'own', it.recorded, teacherOf);
                if (!made.ok) throw new Error(`It could not be assembled: ${made.problem}.`);
                entries.push(...inFolder(folderOf(it), made.assembly.entries));
                const { tampering, unrestored, overridden, refused } = made.assembly;
                outcomes.push({ submission: it.submission, ok: true, report: { tampering, unrestored, overridden, refused }, notes: made.notes });
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

/** `entries` under `folder`, the folder first, so one archive can hold
 *  several students' projects without mixing their files. */
function inFolder(folder: string, entries: readonly Entry[]): Entry[] {
    return [
        { path: folder, type: 'dir', mode: 0o755, mtime: Math.floor(Date.now() / 1000), data: new Uint8Array(0) },
        ...entries.map(e => ({ ...e, path: `${folder}/${e.path}` })),
    ];
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

/** What `r` and `notes` should tell a teacher, one short line each, in the
 *  order they matter; empty when there is nothing to say. The CLI words the
 *  same report for a terminal (`describe` in collect.ts): the wording is
 *  each medium's own, the facts are `assemble`'s. */
export function findings(r: AssemblyReport, notes: readonly string[] = []): string[] {
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
    return [...out, ...notes];
}
