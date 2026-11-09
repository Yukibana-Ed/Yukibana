/** Downloading a submission assembled with its release, in the browser.
 *
 *  A teacher grades a submission put back together with the release's
 *  teacher archive: the student's files, with the read-only and hidden
 *  ones taken from the teacher's (`@yukibana/client/assembly`, the same
 *  assembly `yukibana download --assemble` makes). It happens here, in the
 *  teacher's browser, and not in the Worker: the cloud transforms nothing,
 *  and a Workers free plan allows about 10 ms of CPU per request, where
 *  unpacking and repacking a project takes far more. The Worker only pipes
 *  the two archives through (`?inline`), because a page cannot read a
 *  cross-origin redirect's answer from a bucket without CORS.
 *
 *  Browser only: it fetches, and saves a file through a link.
 */

import type { Tampering } from '@yukibana/client/assembly';
import type { ReleaseId, SubmissionId } from '../ids';

/** What a teacher should know about an assembly they downloaded. Every list
 *  is sorted, and empty when there is nothing to say. */
export interface AssemblyReport {
    /** What the student did to files they were not meant to touch; undone
     *  in the download, except for `unrestored`. */
    readonly tampering: Tampering;
    /** Of `tampering`, what the release assembled with does not protect, so
     *  the student's version stays. */
    readonly unrestored: readonly string[];
    /** Student files replaced because the release assembled with protects
     *  them although the one they started from did not. */
    readonly overridden: readonly string[];
    /** Symlinks out of the project, dropped. */
    readonly refused: readonly string[];
}

/** Fetches `submission` and the teacher archive of `release` through the
 *  Worker, assembles them, and saves the result as `<folder>.tar.gz`,
 *  unpacking into `folder`. Answers what the assembly found, or throws an
 *  `Error` whose message is a sentence for the teacher: an archive that
 *  could not be fetched (with the registry's own sentence) or assembled.
 *
 *  - Requires: `release` is a release of the submission's project; the
 *    page passes the one the student started from, or the newest when
 *    that is unknown, as the CLI does. `folder` has no `/`. */
export async function downloadAssembled(submission: SubmissionId, release: ReleaseId, folder: string): Promise<AssemblyReport> {
    // Loaded on first use, so the library is not in every page's bundle,
    // nor in the Worker's.
    const [{ assembleArchives }, sent, teacher] = await Promise.all([
        import('@yukibana/client/assembly'),
        bytesOf(`/api/submissions/${submission}?inline`, 'the submission'),
        bytesOf(`/api/releases/${release}/teacher?inline`, 'the teacher archive'),
    ]);
    const made = await assembleArchives(folder, sent, teacher);
    if (!made.ok) throw new Error(`It could not be assembled: ${made.problem}.`);
    save(made.archive, `${folder}.tar.gz`);
    const a = made.assembled.assembly;
    return { tampering: a.tampering, unrestored: a.unrestored, overridden: a.overridden, refused: a.refused };
}

/** One submission for `downloadAllAssembled`. */
export interface ToAssemble {
    readonly submission: SubmissionId;
    /** The release to assemble with, as for `downloadAssembled`. */
    readonly release: ReleaseId;
    /** Unique among the batch: what the student's folder is named after
     *  (`folderNames` makes the names, from this and the three below). */
    readonly key: string;
    readonly name: string;
    readonly githubLogin: string | null;
    readonly email: string | null;
    readonly submittedAt: Date;
    readonly late: boolean;
}

/** What `downloadAllAssembled` did with one submission. */
export type Outcome =
    | { readonly submission: SubmissionId; readonly ok: true; readonly folder: string; readonly report: AssemblyReport }
    | { readonly submission: SubmissionId; readonly ok: false; readonly name: string; readonly why: string };

/** How many submissions are fetched and assembled at once: enough to keep
 *  the network busy, few enough that a class's archives are not all in
 *  memory twice at the same moment. */
const AT_ONCE = 4;

/** Assembles every one of `items` as `downloadAssembled` does, and saves
 *  them as one `<slug>-submissions.tar.gz`: a folder per student, named as
 *  `yukibana download` names them, and `yukibana-download.json` beside them
 *  saying which folder is whose, when it was submitted, whether late, and
 *  what each assembly found. Each teacher archive is fetched once however
 *  many students started from it. A submission that cannot be fetched or
 *  assembled is left out and its outcome says why; the others are saved
 *  anyway, unless none could be, and then nothing is. `progress` is called
 *  with the number finished so far after each one. */
export async function downloadAllAssembled(slug: string, items: readonly ToAssemble[], progress: (done: number) => void): Promise<Outcome[]> {
    const lib = await import('@yukibana/client/assembly');
    const folders = lib.folderNames(items.map(i => ({ userId: i.key, fullName: i.name, githubLogin: i.githubLogin, email: i.email })));
    const root = `${slug}-submissions`;
    const teachers = new Map<ReleaseId, Promise<Uint8Array>>();
    const teacherOf = (r: ReleaseId): Promise<Uint8Array> => {
        let got = teachers.get(r);
        if (got === undefined) {
            got = bytesOf(`/api/releases/${r}/teacher?inline`, 'the teacher archive');
            teachers.set(r, got);
        }
        return got;
    };

    const outcomes: Outcome[] = [];
    const entries: import('@yukibana/client/assembly').Entry[] = [];
    let next = 0;
    const work = async (): Promise<void> => {
        for (let i = next++; i < items.length; i = next++) {
            const it = items[i];
            if (it === undefined) continue;
            const folder = folders.get(it.key) ?? it.key;
            try {
                const [sent, teacher] = await Promise.all([bytesOf(`/api/submissions/${it.submission}?inline`, 'the submission'), teacherOf(it.release)]);
                const made = await lib.assembleInto(`${root}/${folder}`, sent, teacher);
                if (!made.ok) throw new Error(`It could not be assembled: ${made.problem}.`);
                entries.push(...made.entries);
                const a = made.assembled.assembly;
                outcomes.push({
                    submission: it.submission,
                    ok: true,
                    folder,
                    report: { tampering: a.tampering, unrestored: a.unrestored, overridden: a.overridden, refused: a.refused },
                });
            } catch (e) {
                outcomes.push({ submission: it.submission, ok: false, name: it.name, why: e instanceof Error ? e.message : String(e) });
            }
            progress(outcomes.length);
        }
    };
    await Promise.all(Array.from({ length: Math.min(AT_ONCE, items.length) }, work));

    if (!outcomes.some(o => o.ok)) return outcomes;
    const byId = new Map(items.map(i => [i.submission, i]));
    const manifest = {
        project: slug,
        downloadedAt: new Date().toISOString(),
        submissions: outcomes.flatMap(o => {
            const it = byId.get(o.submission);
            if (!o.ok || it === undefined) return [];
            return [
                {
                    folder: o.folder,
                    submissionId: o.submission,
                    submittedAt: new Date(it.submittedAt).toISOString(),
                    late: it.late,
                    author: { name: it.name, githubLogin: it.githubLogin, email: it.email },
                    assembledWith: it.release,
                    ...o.report,
                },
            ];
        }),
    };
    const now = Math.floor(Date.now() / 1000);
    const all = [
        { path: root, type: 'dir' as const, mode: 0o755, mtime: now, data: new Uint8Array(0) },
        {
            path: `${root}/yukibana-download.json`,
            type: 'file' as const,
            mode: 0o644,
            mtime: now,
            data: new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}
`),
        },
        ...entries,
    ];
    save(await lib.gzip(await lib.writeTar(all)), `${root}.tar.gz`);
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
        throw new Error(`${what[0]?.toUpperCase() ?? ''}${what.slice(1)} could not be downloaded (${res.status}${said === '' ? '' : `: ${said}`}).`);
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

/** The folder an assembly unpacks into: `<slug>-<login or "student">-<when>`,
 *  the name a plain download of the same submission has, without `.tar.gz`,
 *  and with every character a file system might refuse replaced by `_`. */
export function assemblyFolder(slug: string, login: string | null, submittedAt: Date): string {
    const stamp = new Date(submittedAt).toISOString().replace(/[:.]/g, '-');
    return `${slug}-${login ?? 'student'}-${stamp}`.replace(/[^A-Za-z0-9._-]+/g, '_');
}

/** What `r` should tell a teacher, one sentence per kind of finding, in the
 *  order they matter; empty when the student touched nothing protected. */
export function findings(r: AssemblyReport): string[] {
    const list = (paths: readonly string[]) => paths.join(', ');
    const unrestored = new Set(r.unrestored);
    const restored = (paths: readonly string[]) => paths.filter(p => !unrestored.has(p));
    const out: string[] = [];
    const changed = restored([...r.tampering.modified, ...r.tampering.deleted]);
    if (changed.length > 0) out.push(`Restored protected files the student changed or deleted: ${list(changed)}.`);
    const added = restored(r.tampering.added);
    if (added.length > 0) out.push(`Dropped files the student added under protected paths: ${list(added)}.`);
    if (r.unrestored.length > 0) out.push(`Changed by the student and kept, since the release assembled with no longer protects them: ${list(r.unrestored)}.`);
    if (r.overridden.length > 0) out.push(`Replaced by the release's version, which protects them: ${list(r.overridden)}.`);
    if (r.refused.length > 0) out.push(`Dropped symlinks pointing out of the project: ${list(r.refused)}.`);
    return out;
}
