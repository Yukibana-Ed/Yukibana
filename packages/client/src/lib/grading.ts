/** Which release a submission is assembled with, and which it is compared
 *  with.
 *
 *  A submission says which release it started from twice: the registry
 *  recorded it on arrival (`baseReleaseId`, only ever a release of the same
 *  project), and the student's yukibana.json inside the archive says it
 *  too. They differ only for an archive sent some other way than `submit`,
 *  or one whose file was edited. Either way the student's claim decides
 *  nothing on its own: a release counts only when it is one of the
 *  project's.
 *
 *  Pure but for the one fetch it is handed: lists, ids and bytes in, a
 *  decision and an assembly out. `yukibana download --assemble` and the
 *  registry's staff page do the fetching and say what came of it, each in
 *  its own words.
 */

import { assemble, submissionRoot, type Assembly } from './assemble.js';
import { readArchive, type Entry } from './tar.js';
import { CONFIG_FILE, parseConfig } from './yukibana.js';

/** A release as the decision needs it: the project's list, newest first. */
export interface ReleaseRef {
    /** The release's id, a uuid. */
    readonly releaseId: string;
    /** The label the teacher gave the release, or '' for one without. */
    readonly label: string;
}

/** What `--release` asked for: each submission's own release (the
 *  default), the newest, or one release of the project by id. */
export type Wanted =
    | 'own'
    | 'newest'
    | {
          /** The id of the release asked for, one of the project's (`wantedRelease` checks it). */
          readonly releaseId: string;
      };

/** The releases an assembly of one submission takes, as `chooseReleases` decides them: the one it grades against and the one the student started from. */
export interface Choice<R extends ReleaseRef> {
    /** The release whose read-only and hidden files the assembly takes. */
    readonly grade: R;
    /** The release the student started from, which what they changed is
     *  measured against; null when that is unknown, and then `grade` is. */
    readonly base: R | null;
    /** Anything about the claim a teacher should read, in sentences. */
    readonly notes: readonly string[];
}

/** Returns `r`'s name for a terminal: its label and its whole id, which is
 *  what `--release` takes and the only name that tells two unlabelled
 *  releases apart (the start of a v7 id is only its time). */
export const nameOf = (r: ReleaseRef): string => (r.label === '' ? r.releaseId : `${r.label} (${r.releaseId})`);

/** Returns what `--release` (`given`) names, checked against the project's releases before
 *  anything is downloaded: an id that is not one of them is refused, never
 *  quietly replaced by another. */
export function wantedRelease(releases: readonly ReleaseRef[], given: string | undefined): { ok: true; wanted: Wanted } | { ok: false; problem: string } {
    if (releases.length === 0) return { ok: false, problem: 'no release to assemble with: publish one first' };
    if (given === undefined) return { ok: true, wanted: 'own' };
    if (given === 'newest') return { ok: true, wanted: 'newest' };
    const id = given.toLowerCase();
    if (!releases.some(r => r.releaseId === id)) return { ok: false, problem: `${given} is not a release of this project; \`yukibana releases\` lists them` };
    return { ok: true, wanted: { releaseId: id } };
}

/** Returns the releases for one submission. `releases` is the project's
 *  list, newest first; `recorded` is what the registry kept, `claimed` what
 *  the archive's yukibana.json says.
 *
 *  - Requires: `releases` is not empty (`wantedRelease` refuses an empty
 *    one first); throws otherwise. */
export function chooseReleases<R extends ReleaseRef>(releases: readonly R[], wanted: Wanted, recorded: string | null, claimed: string | null): Choice<R> {
    const find = (id: string | null): R | null => (id === null ? null : (releases.find(r => r.releaseId === id.toLowerCase()) ?? null));
    const newest = releases[0];
    if (newest === undefined) throw new Error('chooseReleases: no releases (wantedRelease refuses that first)');
    const notes: string[] = [];
    const fromRegistry = find(recorded);
    const fromArchive = find(claimed);
    const base = fromRegistry ?? fromArchive;
    if (claimed !== null && fromArchive === null) {
        notes.push(`its yukibana.json names release ${claimed}, which is not a release of this project`);
    } else if (fromRegistry !== null && fromArchive !== null && fromRegistry !== fromArchive) {
        notes.push(`it was sent as started from ${nameOf(fromRegistry)}, but its yukibana.json names ${nameOf(fromArchive)}; compared with ${nameOf(fromRegistry)}`);
    }
    const grade = wanted === 'own' ? (base ?? newest) : wanted === 'newest' ? newest : (find(wanted.releaseId) ?? newest);
    return { grade, base, notes };
}

/** Returns why a submission is not based on the newest release, as a sentence for a
 *  warning, or null when it is (or there are no releases to compare with:
 *  a student's list is empty, since students cannot read releases).
 *  `releases` is the project's list, newest first; `base` the release the
 *  registry recorded for the submission. */
export function behind(releases: readonly ReleaseRef[], base: string | null): string | null {
    const [newest] = releases;
    if (newest === undefined || base === newest.releaseId) return null;
    if (base === null) return `does not say which release it started from, so it may predate the newest, ${nameOf(newest)}`;
    const at = releases.findIndex(r => r.releaseId === base);
    const from = releases[at];
    if (from === undefined) return `started from ${base}, which is not a release of this project`;
    return `started from ${nameOf(from)}, ${at === 1 ? 'one release' : `${at} releases`} behind the newest, ${nameOf(newest)}`;
}

/** The release a submission's own yukibana.json names, or null when it has
 *  none or names nothing readable. The student's claim: `chooseReleases`
 *  counts it only when it is one of the project's releases. */
export function claimedRelease(entries: readonly Entry[]): string | null {
    const cfg = entries.find(e => e.path === CONFIG_FILE && e.type === 'file');
    if (cfg === undefined) return null;
    const parsed = parseConfig(new TextDecoder().decode(cfg.data));
    return parsed.ok ? parsed.config.releaseId : null;
}

/** A submission assembled for grading, or why it could not be, with the
 *  releases `chooseReleases` picked and what it noted, either way. */
export type Graded<R extends ReleaseRef> =
    | {
          /** `true` iff the submission could be assembled. */
          readonly ok: true;
          /** The assembled project and what the student did to protected files. */
          readonly assembly: Assembly;
          /** The release the assembly took its protected files from. */
          readonly grade: R;
          /** The release the student started from, which their changes were
           *  measured against; null when unknown. */
          readonly base: R | null;
          /** Sentences a teacher should read: a claim that does not hold up,
           *  or a base release that could not be fetched. */
          readonly notes: readonly string[];
      }
    | {
          /** `true` iff the submission could be assembled. */
          readonly ok: false;
          /** Why it could not, in a sentence. */
          readonly problem: string;
          readonly notes: readonly string[];
      };

/** `archive`, a submission as sent, assembled with the releases
 *  `chooseReleases` picks for it among `releases` (the project's, newest
 *  first): read, its claim and the registry's record (`recorded`) weighed,
 *  the grading release's teacher archive overlaid, and the student's
 *  changes measured against the release they started from. `teacherOf`
 *  fetches a release's teacher archive, as entries; it is asked at most
 *  twice. This is the whole of `yukibana download --assemble` and the
 *  registry's Download for one submission; the callers do the I/O and the
 *  words around it.
 *
 *  Throws what reading `archive` or fetching the grading release throws. A
 *  base release that cannot be fetched is a note, and the changes are then
 *  measured against the grading release.
 *
 *  - Requires: `releases` is not empty. */
export async function assembleSubmission<R extends ReleaseRef>(
    archive: Uint8Array,
    releases: readonly R[],
    wanted: Wanted,
    recorded: string | null,
    teacherOf: (r: R) => Promise<readonly Entry[]>,
): Promise<Graded<R>> {
    const entries = submissionRoot(await readArchive(archive));
    const { grade, base, notes } = chooseReleases(releases, wanted, recorded, claimedRelease(entries));
    const teacher = await teacherOf(grade);
    let against = teacher;
    const said = [...notes];
    if (base !== null && base !== grade) {
        try {
            against = await teacherOf(base);
        } catch (e) {
            said.push(`${e instanceof Error ? e.message : String(e)}; what the student changed is measured against ${nameOf(grade)} instead`);
        }
    }
    const made = assemble(entries, teacher, against);
    if (!made.ok) return { ok: false, problem: made.problem, notes: said };
    return { ok: true, assembly: made.assembly, grade, base, notes: said };
}
