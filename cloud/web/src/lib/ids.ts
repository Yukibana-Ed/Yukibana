/** Ids with their table in the type.
 *
 *  Every id is a uuid, so every id looks like every other id, and a project
 *  id passed where an edition id was expected does not fail: it reads
 *  nothing, or worse, reads the wrong thing. The brands make that a compile
 *  error. A string becomes an id in exactly two places: `uuidOf` at a
 *  boundary (a route parameter, a form field), which checks the shape, and
 *  `trustId` for a value the database just returned.
 */

declare const TABLE: unique symbol;

/** A person's id: `app_user.user_id`, the same uuid as `auth.users.id`.
 *  Invariant (for every table id here, `UserId` to `SubmissionId`, not
 *  `ObjectKey`): a lowercase uuid, made only by `uuidOf`, `trustId`, or a
 *  cast of a fresh `crypto.randomUUID()` for a row about to be inserted
 *  (`recordSubmission`). */
export type UserId = string & { readonly [TABLE]: 'app_user' };
/** A course's id: `course.course_id`. */
export type CourseId = string & { readonly [TABLE]: 'course' };
/** An edition's id: `course_edition.edition_id`. */
export type EditionId = string & { readonly [TABLE]: 'course_edition' };
/** A project's id: `project.project_id`. */
export type ProjectId = string & { readonly [TABLE]: 'project' };
/** A release's id: `project_release.release_id`, which the publisher may
 *  choose and write into the starter's yukibana.json. */
export type ReleaseId = string & { readonly [TABLE]: 'project_release' };
/** A project token's id: `project_token.token_id`. Never the token's secret,
 *  which is not stored. */
export type TokenId = string & { readonly [TABLE]: 'project_token' };
/** A teacher invite's id: `teacher_invite.invite_id`. Never the invite's secret, which only the link holds. */
export type InviteId = string & { readonly [TABLE]: 'teacher_invite' };
/** A submission's id: `submission.submission_id`, also the name of its
 *  object (`submissionKey`). */
export type SubmissionId = string & { readonly [TABLE]: 'submission' };

/** Where bytes live in the bucket. Never a URL: see the submission table.
 *
 *  Invariant: a path, not a uuid, made only by `submissionKey`,
 *  `starterKey` or `teacherKey` for an object about to be stored, or by
 *  `trustKey` for a key the database returned (a test may cast its own). */
export type ObjectKey = string & { readonly [TABLE]: 'object' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Returns `value` as an id, if it is a uuid from outside (a route
 *  parameter, a form field), or null when it is null, undefined or not
 *  shaped like a uuid (8-4-4-4-12 hexadecimal digits, either case, no
 *  braces). Lowercased, so the same id is always the same string. The
 *  shape is all that is checked: the id may name nothing, or a row of
 *  another table than `T` says, and the database's answer is what tells. */
export function uuidOf<T extends string>(value: string | null | undefined): T | null {
    if (value === null || value === undefined || !UUID.test(value)) return null;
    return value.toLowerCase() as T;
}

/** Returns `value`, an id the database returned, as a `T`. Not checked:
 *  the database is the source.
 *
 *  - Requires: `value` came from the column `T` names; a string from
 *    anywhere else goes through `uuidOf`. Nothing enforces this, which is
 *    why it has a name to grep for. */
export const trustId = <T extends string>(value: string): T => value as T;

/** Returns `value`, an object key the database returned, as an
 *  `ObjectKey`, likewise unchecked: a key from anywhere else must not be
 *  passed here. */
export const trustKey = (value: string): ObjectKey => value as ObjectKey;

/** Returns the key for a submission's body. One prefix per kind of object, so a bucket
 *  listing sorts by what things are, and a lifecycle rule can tell them apart. */
export const submissionKey = (submission: SubmissionId): ObjectKey => `submissions/${submission}.tar.gz` as ObjectKey;

/** Returns the key for a release's starter: what students download. `object` is a
 *  fresh random id, not the release id: the object is stored before the row
 *  exists, and the row remembers the key. */
export const starterKey = (project: ProjectId, object: string): ObjectKey => `starters/${project}/${object}.tar.gz` as ObjectKey;

/** Returns the key for a release's teacher archive: the whole project, hidden tests
 *  included. Never served to a student. */
export const teacherKey = (project: ProjectId, object: string): ObjectKey => `teacher/${project}/${object}.tar.gz` as ObjectKey;
