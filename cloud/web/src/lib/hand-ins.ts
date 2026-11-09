/** Where each student of a project stands: who has handed something in,
 *  who handed it in late, and what each hand-in was built on.
 *
 *  The staff's Submissions tab is one row per student, not one per
 *  submission: a teacher's question is "who still owes me this?", and a
 *  list of submissions cannot answer it, because the students who sent
 *  nothing are not in it. This module turns the two lists the page loads
 *  (the edition's students and the project's submissions) into those rows.
 *  It decides nothing the database decides: who is late and which release
 *  is the newest come from the rows as the database wrote them.
 */

import type { ReleaseId, SubmissionId, UserId } from './ids';

/** A student enrolled in the project's edition, as the page loads them. */
export interface EnrolledStudent {
    /** The address they were enrolled with, lowercase. The one name every
     *  enrolment has, so the order and the fallback label. */
    readonly email: string;
    /** Their account, or null while nobody has logged in with `email`: such
     *  a student cannot have submitted anything. */
    readonly userId: UserId | null;
    /** Their name, as their login provider gave it; null when it gave none
     *  or they have not logged in. */
    readonly fullName: string | null;
    /** Their GitHub login, without the `@`; null for an email login. */
    readonly githubLogin: string | null;
}

/** One submission of the project, as the page loads them for staff. */
export interface HandIn {
    readonly submissionId: SubmissionId;
    readonly authorId: UserId;
    /** When the server received it. */
    readonly submittedAt: Date;
    /** The archive's size, in bytes. */
    readonly byteSize: number;
    /** The archive's SHA-256, 64 lowercase hex digits. */
    readonly sha256: string;
    /** Whether it arrived after the project's deadline, as the database
     *  compared them. A project without a deadline has no late work. */
    readonly late: boolean;
    /** The release the student's folder said it started from, or null when
     *  it said none (an upload through the page, a folder from before
     *  starters carried their release) or named a release that is not this
     *  project's, which the database does not keep. */
    readonly base: Base | null;
    /** The author's name and login, for a submission whose author is no
     *  longer enrolled; the same as their enrolment's otherwise. */
    readonly fullName: string | null;
    readonly githubLogin: string | null;
}

/** The release a submission was built on. */
export interface Base {
    readonly releaseId: ReleaseId;
    /** The release's label, or '' when it was published without one. */
    readonly label: string;
    /** Its place among the project's releases, counting from 1 for the
     *  first: what the page calls its version, since a label is optional
     *  and two releases may carry the same one. */
    readonly version: number;
    /** Whether it is the project's newest release. */
    readonly latest: boolean;
}

/** How a student stands with the project, judged by their newest
 *  submission alone: an early on-time hand-in followed by a late one is
 *  late, because the newest is the one assessed. */
export type Standing = 'missing' | 'on-time' | 'late';

/** One student's line on the Submissions tab. */
export interface StudentHandIns {
    /** A stable key for the line: the account when there is one, else the
     *  enrolment address. */
    readonly key: string;
    /** What to call them: their name, else their login, else their address. */
    readonly name: string;
    /** Their GitHub login, or null. */
    readonly githubLogin: string | null;
    /** Their enrolment address, or null for an author who is no longer
     *  enrolled, whose address the page cannot read. */
    readonly email: string | null;
    /** False for an author of submissions who is no longer one of the
     *  edition's students (unenrolled, or made staff): their work stays
     *  evidence and stays on the list. */
    readonly enrolled: boolean;
    /** Every submission of theirs, newest first; empty for none. */
    readonly submissions: readonly HandIn[];
    /** `submissions[0]`, or null: the one assessed, shown by default. */
    readonly latest: HandIn | null;
    readonly standing: Standing;
}

/** Whether `h` was built on a release other than the newest. A submission
 *  that names no release is not called outdated: nothing says it is. */
export const outdated = (h: HandIn): boolean => h.base !== null && !h.base.latest;

/** The line under a student's name: their login, else their address
 *  when it is not already their name, and whether they have left the
 *  edition, joined by " · "; '' when there is nothing to add. One handle,
 *  not both: the line is for telling two Alices apart, not a contact card. */
export function subtitle(l: StudentHandIns): string {
    const handle = l.githubLogin !== null ? `@${l.githubLogin}` : l.email !== null && l.email !== l.name ? l.email : '';
    return [handle, l.enrolled ? '' : 'no longer enrolled'].filter(p => p !== '').join(' · ');
}

/** What to call a release in a sentence: "v3 (week 2)", or "v3" when it
 *  has no label. */
export const versionName = (b: Base): string => (b.label === '' ? `v${b.version}` : `v${b.version} (${b.label})`);

/** One line per student of `students`, and one more for every other author
 *  in `submissions`, each with their submissions newest first.
 *
 *  Order: students who have submitted nothing first, then late, then on
 *  time, each group by name, because that is the order a teacher chases
 *  them in. Authors no longer enrolled come last of their group.
 *
 *  - Requires: every submission's `authorId` is an account; `students`
 *    holds each address once (the enrolment's primary key). */
export function handInsOf(students: readonly EnrolledStudent[], submissions: readonly HandIn[]): StudentHandIns[] {
    const byAuthor = new Map<UserId, HandIn[]>();
    for (const s of submissions) {
        const list = byAuthor.get(s.authorId);
        if (list === undefined) byAuthor.set(s.authorId, [s]);
        else list.push(s);
    }
    for (const list of byAuthor.values()) list.sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime());

    const lines: StudentHandIns[] = [];
    const seen = new Set<UserId>();
    for (const st of students) {
        const own = st.userId === null ? [] : (byAuthor.get(st.userId) ?? []);
        if (st.userId !== null) seen.add(st.userId);
        lines.push(line(st.userId ?? st.email, st.fullName ?? st.githubLogin ?? st.email, st.githubLogin, st.email, true, own));
    }
    for (const [author, own] of byAuthor) {
        if (seen.has(author)) continue;
        const first = own[0];
        lines.push(line(author, first?.fullName ?? first?.githubLogin ?? 'Unknown student', first?.githubLogin ?? null, null, false, own));
    }
    const rank: Record<Standing, number> = { missing: 0, late: 1, 'on-time': 2 };
    return lines.toSorted(
        (a, b) => rank[a.standing] - rank[b.standing] || Number(b.enrolled) - Number(a.enrolled) || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
    );
}

function line(key: string, name: string, githubLogin: string | null, email: string | null, enrolled: boolean, submissions: HandIn[]): StudentHandIns {
    const latest = submissions[0] ?? null;
    const standing: Standing = latest === null ? 'missing' : latest.late ? 'late' : 'on-time';
    return { key, name, githubLogin, email, enrolled, submissions, latest, standing };
}

/** How many lines of `lines` stand each way, for a summary. */
export function tally(lines: readonly StudentHandIns[]): Record<Standing, number> & { outdated: number } {
    const t = { missing: 0, late: 0, 'on-time': 0, outdated: 0 };
    for (const l of lines) {
        t[l.standing] += 1;
        if (l.latest !== null && outdated(l.latest)) t.outdated += 1;
    }
    return t;
}

/** The designs the Submissions tab can be drawn in, while one is chosen.
 *  `?design=` names one; anything else is the first. */
export const DESIGNS = [
    { id: 'table', label: 'A · Table' },
    { id: 'cards', label: 'B · Cards' },
    { id: 'groups', label: 'C · Groups' },
    { id: 'split', label: 'D · Split view' },
] as const;

/** One of `DESIGNS`' ids. */
export type Design = (typeof DESIGNS)[number]['id'];

/** The design `url` asks for, or the first. */
export function designOf(url: { readonly searchParams: { get(name: string): string | null } }): Design {
    const asked = url.searchParams.get('design');
    return DESIGNS.find(d => d.id === asked)?.id ?? DESIGNS[0].id;
}
