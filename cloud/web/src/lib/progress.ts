/** Where a student stands with a project, in one word, and when it is due.
 *  Pure: the project's dates, the student's newest submission and a clock in;
 *  what the lists show out. The database decides what may be submitted;
 *  this only says it.
 */

import type { EditionId, ProjectId } from './ids';

/** Where a student stands with one project, as `progressOf` decides it. */
export type Progress =
    /** Submitted, and the newest submission was on time. */
    | 'submitted'
    /** Submitted, but the newest submission came after the deadline. */
    | 'late'
    /** Nothing submitted, and the deadline has not passed (or there is none). */
    | 'todo'
    /** Nothing submitted, the deadline has passed, and it still takes work. */
    | 'overdue'
    /** Nothing submitted, and the database would not take a submission
     *  now (`can_submit` is false), for whatever reason: not necessarily for
     *  good. */
    | 'missed';

/** A student's project as the lists show it: one row of
 *  `studentProjects` (server/student.ts), read as the student. Field names
 *  are the database's. */
export interface StudentProjectRow {
    /** The project. */
    readonly project_id: ProjectId;
    /** The edition the project is in. */
    readonly edition_id: EditionId;
    /** The course's code, as it is listed now. */
    readonly course_code: string;
    /** The course name of the project's own edition, not the course's latest. */
    readonly course_title: string;
    /** The edition's label, like "2026 autumn". */
    readonly edition_label: string;
    /** The project's slug: the folder students unpack. */
    readonly slug: string;
    /** The project's title. */
    readonly title: string;
    /** The project's kind, one of `KINDS` (#lib/kinds), as text. */
    readonly kind: string;
    /** The deadline, or null for none. Submitting after it is late, not
     *  refused. */
    readonly deadline: Date | null;
    /** When submissions stop being accepted, or null for never. */
    readonly closes_at: Date | null;
    /** The database's answer to "may this student submit now". */
    readonly can_submit: boolean;
    /** `true` iff the project has a starter to download now. */
    readonly starter_ready: boolean;
    /** How many versions the student has submitted. */
    readonly submissions: number;
    /** The student's newest submission, or null. */
    readonly last_submitted_at: Date | null;
}

/** What progress is decided from: the dates, the newest submission, and
 *  whether the database would take another. */
export type ProgressInput = Pick<StudentProjectRow, 'deadline' | 'closes_at' | 'last_submitted_at' | 'can_submit'>;

/** Returns where the student stands with `p` at `now`.
 *
 *  A submission decides first: 'late' iff the newest one came strictly
 *  after the deadline, else 'submitted', whatever the database would take
 *  now. Without one, 'missed' iff the database would take none, else
 *  'overdue' once `now` has reached the deadline, else 'todo'. So 'missed'
 *  means only that the database refuses now, for whatever reason it has:
 *  `can_submit` is the one input that says so. */
export function progressOf(p: ProgressInput, now: Date): Progress {
    if (p.last_submitted_at !== null) {
        return p.deadline !== null && p.last_submitted_at > p.deadline ? 'late' : 'submitted';
    }
    if (!p.can_submit) return 'missed';
    return p.deadline !== null && p.deadline <= now ? 'overdue' : 'todo';
}

/** `true` iff a project with progress `p` belongs on the to-do list:
 *  nothing handed in yet, and it can still be ('todo' or 'overdue'). */
export const outstanding = (p: Progress): boolean => p === 'todo' || p === 'overdue';

/** The words for a progress, for a chip. */
export const PROGRESS_LABEL: Record<Progress, string> = {
    submitted: 'Submitted',
    late: 'Submitted late',
    todo: 'Not submitted',
    overdue: 'Overdue',
    missed: 'Missed',
};

const DAY = 86_400_000;
const HOUR = 3_600_000;

/** Returns how far away `deadline` is from `now`, as a person says it: "due in 3 days", "due
 *  in 5 hours", "due within 2 hours", "2 days past the deadline", "just past
 *  the deadline", "no deadline". Whole units, rounded down. */
export function dueIn(deadline: Date | null, now: Date): string {
    if (deadline === null) return 'no deadline';
    const ms = deadline.getTime() - now.getTime();
    const abs = Math.abs(ms);
    const amount = abs >= 2 * DAY ? `${Math.floor(abs / DAY)} days` : abs >= 2 * HOUR ? `${Math.floor(abs / HOUR)} hours` : null;
    if (ms >= 0) return amount === null ? 'due within 2 hours' : `due in ${amount}`;
    return amount === null ? 'just past the deadline' : `${amount} past the deadline`;
}

/** Returns the to-do list's order of `a` and `b`, as a comparator for
 *  `Array.prototype.sort`: negative when `a` comes first. By deadline, soonest first, so whatever
 *  is overdue comes before everything else; those without one last, in
 *  the order they came (two without a deadline compare as NaN, which
 *  `sort` treats as equal). */
export function byUrgency<T extends { readonly deadline: Date | null }>(a: T, b: T): number {
    const t = (x: T): number => (x.deadline === null ? Number.POSITIVE_INFINITY : x.deadline.getTime());
    return t(a) - t(b);
}
