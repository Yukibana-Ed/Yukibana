/** What the JSON API answers. The CLI and the IDE extension read these
 *  shapes (`packages/client/src/lib/wire.ts` decodes them, field for field), so a
 *  change here is a change to a published contract: add a field, never
 *  rename or retype one. Times are ISO 8601 strings in UTC; ids are uuids;
 *  a null means what the field says it means.
 */

/** A person's role in one edition, as `app.edition_role` spells it.
 *  Staff are `assistant` and `owner`; only an `owner` changes the roster. */
export type EditionRole = 'student' | 'assistant' | 'owner';

/** `GET /api/me`: the person the verified token is for. */
export interface MeJson {
    /** Their user id, the token's `sub`. */
    readonly userId: string;
    /** The address in the verified token. */
    readonly email: string | null;
    /** Their name, which they may change; null when they have given none or
     *  have no profile row yet. */
    readonly fullName: string | null;
    /** Their GitHub login, lowercased; null when their sign-in gave none or
     *  they have no profile row yet. */
    readonly githubLogin: string | null;
    /** `user`, `teacher` or `admin`; `user` for someone with no profile row yet. */
    readonly platformRole: string;
}

/** An edition the caller is enrolled in (`GET /api/editions`): the policy
 *  shows nobody, admins included, an edition they are not a member of. */
export interface EditionJson {
    /** The edition's id. */
    readonly editionId: string;
    /** The course's code, like `CS-101`, shared by every edition of the course. */
    readonly courseCode: string;
    /** The course name this edition runs under, which its owners set; other
     *  editions of the same course may have another. */
    readonly courseTitle: string;
    /** The edition's label for people, like `2026 autumn`. */
    readonly label: string;
    /** `true` iff an owner has archived the edition. */
    readonly archived: boolean;
    /** The caller's role in it. */
    readonly role: EditionRole;
}

/** A project the caller may see (`GET /api/projects`, `GET /api/projects/:id`):
 *  staff see every project of their editions, a student only those whose
 *  window is open now (`availableAfter` passed, `closesAt` not yet). */
export interface ProjectJson {
    /** The project's id. */
    readonly projectId: string;
    /** The edition it belongs to. */
    readonly editionId: string;
    /** The code of the edition's course. */
    readonly courseCode: string;
    /** The edition's label. */
    readonly editionLabel: string;
    /** The project's short name: lowercase letters, digits and `-`, unique in its edition. */
    readonly slug: string;
    /** The project's title for people. */
    readonly title: string;
    /** The toolchain the project is built with, `app.project_kind` as text
     *  (`rust-cargo` or `scala-sbt` today). A string, not a union, so that a
     *  kind added later does not break a client that only shows it. */
    readonly kind: string;
    /** When it opens to students. Null: a draft, which only staff see. */
    readonly availableAfter: string | null;
    /** When work is due. Null: no deadline. Submissions after it are still
     *  accepted until `closesAt`, and read as late. */
    readonly deadline: string | null;
    /** When the window closes: after it a student no longer sees the project
     *  and cannot submit. Null: it never closes. */
    readonly closesAt: string | null;
    /** `true` iff the deadline has passed: a submission now would be late.
     *  Always `false` without a deadline. */
    readonly late: boolean;
    /** The caller's role in the project's edition. */
    readonly role: EditionRole;
    /** `true` iff a starter has been released and the caller may download it. */
    readonly starterReady: boolean;
    /** The release whose starter the caller would download now
     *  (`app.current_release`), to compare with the `releaseId` in a
     *  student's `yukibana.json` and to fetch by id. Null exactly when
     *  `starterReady` is false. */
    readonly currentReleaseId: string | null;
    /** `true` iff the caller may submit right now: only ever true for a student,
     *  between `availableAfter` and `closesAt`, before the deadline or after. */
    readonly canSubmit: boolean;
    /** How many submissions the caller has made to it; only a student can submit. */
    readonly mySubmissions: number;
    /** When the caller's newest submission to it arrived; null when they have none. */
    readonly myLastSubmittedAt: string | null;
}

/** A submission's record (`GET /api/projects/:id/submissions`): staff see
 *  everyone's, a student only their own, also after the project's window
 *  has closed. The archive itself is downloaded separately. */
export interface SubmissionJson {
    /** The submission's id. */
    readonly submissionId: string;
    /** The project it was submitted to. */
    readonly projectId: string;
    /** When it arrived, as the database stamped it. */
    readonly submittedAt: string;
    /** Bytes, as stored. */
    readonly byteSize: number;
    /** Hex SHA-256 of the archive, as the server computed it on arrival. */
    readonly sha256: string;
    /** Who submitted it, as far as the caller may see them. */
    readonly author: {
        /** The author's user id; always present, even when the rest is hidden. */
        readonly userId: string;
        /** The author's name; null when they have none, or chose not to show it to the caller (`app.visible_name`). */
        readonly fullName: string | null;
        /** The author's GitHub login; null when they have none or the caller may not see their profile. */
        readonly githubLogin: string | null;
        /** The address they are enrolled with, when the caller may see it
         *  (themselves, or staff); null otherwise, or after unenrolment. */
        readonly email: string | null;
    };
    /** `true` iff this is the author's newest submission to the project. */
    readonly latest: boolean;
    /** `true` iff it arrived after the project's deadline, as the deadline is
     *  now: an extension granted later makes it on time again. */
    readonly late: boolean;
    /** The release the student's folder said it started from, always one of
     *  this project's. Null for a submission from before releases carried
     *  ids, a hand-made archive, one uploaded through the project page (which
     *  does not open the archive to read the id), or a claim that named no
     *  release of this project. A student's claim: it says which release to compare their
     *  read-only files with, and decides nothing about who may do what. */
    readonly baseReleaseId: string | null;
}

/** A release's record (`GET /api/projects/:id/releases`), which only staff
 *  read: a student gets an empty list. */
export interface ReleaseJson {
    /** The release's id, which its starter's `yukibana.json` carries when the CLI built it with one. */
    readonly releaseId: string;
    /** The label for people it was published with (a tag, a branch); may be ''. */
    readonly label: string;
    /** The commit its archives were built from, as the publisher said; null when it said none. */
    readonly commit: string | null;
    /** The starter archive's size in bytes. */
    readonly starterSize: number;
    /** The teacher archive's size in bytes. */
    readonly teacherSize: number;
    /** When it was published. */
    readonly uploadedAt: string;
    /** Login or name of whoever uploaded it (or whose token did); null when
     *  they have neither or the caller may no longer see their profile. */
    readonly uploadedBy: string | null;
    /** `true` iff it was published with a project token rather than by a person signed in. */
    readonly viaToken: boolean;
}

/** An enrolment in an edition (`GET /api/editions/:id/members`): staff see
 *  every row, a student only their own. */
export interface MemberJson {
    /** The enrolled address, lowercased. */
    readonly email: string;
    /** The role it is enrolled with. */
    readonly role: EditionRole;
    /** `manual`, or the roster feed that owns the row. */
    readonly source: string;
    /** Null until the address has logged in. */
    readonly userId: string | null;
    /** The person's name; null before they log in, when they have none, or when they chose not to show it to the caller. */
    readonly fullName: string | null;
    /** The person's GitHub login; null before they log in or when they have none. */
    readonly githubLogin: string | null;
}

/** What a terminal or an IDE needs to log in: the Auth server and its
 *  publishable key. Neither is secret; both are in every page already. */
export interface AuthConfigJson {
    /** The Auth server's URL. */
    readonly supabaseUrl: string;
    /** The Auth server's publishable (anonymous) key. */
    readonly publishableKey: string;
    /** The OAuth client a terminal or IDE logs in through, by way of
     *  `/auth/connect` on this site; null when the registry has none, and a
     *  CLI then logs in with GitHub directly. A CLI older than this field
     *  ignores it and does the same. */
    readonly oauthClientId: string | null;
    /** The site's canonical origin, Auth's `site_url`: where a CLI opens
     *  `/auth/connect`, and whose `/auth/connect/return` it names when it
     *  trades the code. */
    readonly siteUrl: string;
}

/** Every refusal and failure under `/api/`, whatever the status and whatever
 *  the caller's `Accept` says: a 400 for a request that cannot mean
 *  anything, 401 for no session, 403 for a session that may not, 404 for no
 *  such thing, 409 for a conflict, 5xx for the server's fault. `message` is
 *  a sentence for a person; a client branches on the status, never on the
 *  wording. A redirect or a 204 has no body at all. */
export interface ErrorJson {
    /** The response's own status, repeated for a client that kept only the body. */
    readonly status: number;
    /** A sentence for a person, saying what went wrong. */
    readonly message: string;
}
