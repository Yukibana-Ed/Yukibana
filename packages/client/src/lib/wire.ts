/** What the registry's JSON API answers, as the CLI relies on it.
 *
 *  `cloud/web/src/lib/api.ts` is the other side and says the same in the same
 *  words. Every response is `unknown` until one of the decoders here has
 *  looked at it: a registry of another version answers something else, and
 *  "the registry answered `deadline` as a number" is a better sentence than
 *  a TypeError three calls later. Times are ISO 8601 strings in UTC; a null
 *  means what the field says it means.
 */

import * as z from 'zod';
// The function form of .default(), which zod spells _default, since default is a keyword.
import { _default as withDefault } from 'zod';
import { fieldOf, nameOf } from './issues.js';

/** A person's role in an edition. Staff are `assistant` and `owner`; only an
 *  `owner` changes the roster. */
export type EditionRole = 'student' | 'assistant' | 'owner';

/** The person the access token is for. */
export interface Me {
    /** Their user id, the token's `sub`. */
    readonly userId: string;
    /** The address in the verified token; null when it has none. */
    readonly email: string | null;
    /** Their name, which they may change; null when they have given none or
     *  have no profile row yet. */
    readonly fullName: string | null;
    /** Their GitHub login, lowercased; null when their sign-in gave none or
     *  they have no profile row yet. */
    readonly githubLogin: string | null;
    /** `user`, `teacher` or `admin`. A string, not a union, so that a role
     *  added later decodes. */
    readonly platformRole: string;
}

/** An edition the caller is enrolled in. */
export interface Edition {
    /** The edition's id. */
    readonly editionId: string;
    /** The course's code, like `CS-101`, shared by every edition of the course. */
    readonly courseCode: string;
    /** The course name this edition runs under; other editions of the same
     *  course may have another. */
    readonly courseTitle: string;
    /** The edition's label for people, like `2026 autumn`. */
    readonly label: string;
    /** `true` iff an owner has archived the edition. */
    readonly archived: boolean;
    /** The caller's role in it. */
    readonly role: EditionRole;
}

/** A project the caller may see, with what it means for them. Staff see
 *  every project of their editions; a student only those whose window is
 *  open now. */
export interface Project {
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
    /** The toolchain the project is built with (`rust-cargo` or `scala-sbt`
     *  today). A string, not a union, so that a kind added later decodes. */
    readonly kind: string;
    /** When it opens to students. Null: a draft, which only staff see. */
    readonly availableAfter: string | null;
    /** When work is due. Null: no deadline. Later submissions are accepted
     *  until `closesAt`, and read as late. */
    readonly deadline: string | null;
    /** When the window closes: after it a student no longer sees the project
     *  and cannot submit. Null: never. */
    readonly closesAt: string | null;
    /** `true` iff the deadline has passed: a submission now would be late.
     *  Always `false` without a deadline. */
    readonly late: boolean;
    /** The caller's role in the project's edition. */
    readonly role: EditionRole;
    /** `true` iff a starter has been released and the caller may download it. */
    readonly starterReady: boolean;
    /** The newest release whose starter the caller may download now: what an
     *  IDE compares with the folder's `releaseId` to know an update exists,
     *  and the id to download it by (`downloadRelease(id, 'starter')`), so
     *  that a release published meanwhile cannot slip in. Null when the
     *  project has no release, when the caller may not download from it now,
     *  and from a registry older than this field. */
    readonly currentReleaseId: string | null;
    /** `true` iff the caller may submit right now: only ever true for a
     *  student, between `availableAfter` and `closesAt`, before the deadline
     *  or after. */
    readonly canSubmit: boolean;
    /** How many submissions the caller has made to it; only a student can submit. */
    readonly mySubmissions: number;
    /** When the caller's newest submission to it arrived; null when they have none. */
    readonly myLastSubmittedAt: string | null;
}

/** The person a submission is by, as far as the caller may see them. */
export interface Author {
    /** The author's user id; always present, even when the rest is hidden. */
    readonly userId: string;
    /** The author's name; null when they have none or the caller may not see their profile. */
    readonly fullName: string | null;
    /** The author's GitHub login; null when they have none or the caller may not see their profile. */
    readonly githubLogin: string | null;
    /** The address they were enrolled with; null when the caller may not see
     *  it or the enrolment is gone. */
    readonly email: string | null;
}

/** A submission's record; the archive itself is downloaded separately
 *  (`downloadSubmission`). Staff see everyone's, a student only their own. */
export interface Submission {
    /** The submission's id. */
    readonly submissionId: string;
    /** The project it was submitted to. */
    readonly projectId: string;
    /** When it arrived, as the registry's database stamped it. */
    readonly submittedAt: string;
    /** The archive's size in bytes, as stored. */
    readonly byteSize: number;
    /** Hex SHA-256 of the archive, as the registry computed it on arrival. */
    readonly sha256: string;
    /** Who submitted it. */
    readonly author: Author;
    /** `true` iff this is the author's newest submission to the project: the
     *  one that counts. */
    readonly latest: boolean;
    /** `true` iff it arrived after the deadline, as the deadline is now. */
    readonly late: boolean;
    /** The release it started from, always one of its project's; null when
     *  unknown (older submissions, hand-made archives, one uploaded through
     *  the project page, a claim that named no release of the project, or a
     *  registry from before releases had ids). The student's claim: it
     *  decides nothing about who may do what. */
    readonly baseReleaseId: string | null;
}

/** A release's record, as staff see it; a student is listed none. */
export interface Release {
    /** The release's id. */
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

/** An enrolment in an edition. Staff see every one; a student only their own. */
export interface Member {
    /** The enrolled address, lowercased. */
    readonly email: string;
    /** The role it is enrolled with. */
    readonly role: EditionRole;
    /** `manual`, or the roster feed that owns the row. */
    readonly source: string;
    /** Null until the address has logged in. */
    readonly userId: string | null;
    /** The person's name; null before they log in or when they have none. */
    readonly fullName: string | null;
    /** The person's GitHub login; null before they log in or when they have none. */
    readonly githubLogin: string | null;
}

/** The registry's receipt for a submission it stored. */
export interface Accepted {
    /** The new submission's id. */
    readonly submissionId: string;
    /** The archive's size in bytes, as the registry stored it. */
    readonly byteSize: number;
    /** Hex SHA-256 of the archive, as the registry computed it. */
    readonly sha256: string;
}

/** The registry's receipt for a release it stored: each archive's size in bytes and SHA-256. */
export interface Published {
    /** The new release's id: the one `publishRelease` was given, or the registry's choice when it was given none. */
    readonly releaseId: string;
    /** The starter archive's size in bytes and hex SHA-256, as stored. */
    readonly starter: { readonly size: number; readonly sha256: string };
    /** The teacher archive's size in bytes and hex SHA-256, as stored. */
    readonly teacher: { readonly size: number; readonly sha256: string };
}

/** The public half of the registry's Auth configuration: what a browser
 *  login needs, and nothing secret. */
export interface AuthConfig {
    /** The Auth server's URL. */
    readonly supabaseUrl: string;
    /** The Auth server's publishable (anonymous) key. */
    readonly publishableKey: string;
    /** The registry's OAuth client on that Auth server, through which a
     *  loopback login goes by way of the website (`/auth/connect`). Null from
     *  a registry that has none, or that is older than the field: the login
     *  then goes to GitHub directly, as it always did. */
    readonly oauthClientId: string | null;
    /** The site's canonical origin (Auth's `site_url`), where the website's
     *  part of the login works; null from a registry older than the field,
     *  which is then its own site. */
    readonly siteUrl: string | null;
}

/** A response that is not what this version expects. */
export class Unexpected extends Error {}

const text = z.string();
const maybeText = withDefault(z.nullable(z.string()), null);
const count = z.number().check(z.refine(Number.isFinite));
const role = z.enum(['student', 'assistant', 'owner']);

// Each schema's output is checked against the documented interface above by
// the decoder's return type, so the two cannot drift apart.
const me = z.object({ userId: text, email: maybeText, fullName: maybeText, githubLogin: maybeText, platformRole: text });
const edition = z.object({ editionId: text, courseCode: text, courseTitle: text, label: text, archived: z.boolean(), role });
const project = z.object({
    projectId: text,
    editionId: text,
    courseCode: text,
    editionLabel: text,
    slug: text,
    title: text,
    kind: text,
    availableAfter: maybeText,
    deadline: maybeText,
    closesAt: maybeText,
    late: z.boolean(),
    role,
    starterReady: z.boolean(),
    currentReleaseId: maybeText,
    canSubmit: z.boolean(),
    mySubmissions: count,
    myLastSubmittedAt: maybeText,
});
const submission = z.object({
    submissionId: text,
    projectId: text,
    submittedAt: text,
    byteSize: count,
    sha256: text,
    latest: z.boolean(),
    late: z.boolean(),
    baseReleaseId: maybeText,
    author: z.object({ userId: text, fullName: maybeText, githubLogin: maybeText, email: maybeText }),
});
const release = z.object({
    releaseId: text,
    label: text,
    commit: maybeText,
    starterSize: count,
    teacherSize: count,
    uploadedAt: text,
    uploadedBy: maybeText,
    viaToken: z.boolean(),
});
const member = z.object({ email: text, role, source: text, userId: maybeText, fullName: maybeText, githubLogin: maybeText });
const accepted = z.object({ submissionId: text, byteSize: count, sha256: text });
const archive = z.object({ size: count, sha256: text });
const published = z.object({ releaseId: text, starter: archive, teacher: archive });
const authConfig = z.object({ supabaseUrl: text, publishableKey: text, oauthClientId: maybeText, siteUrl: maybeText });

/** Returns `v` as `schema` says, or throws `Unexpected` with a sentence for
 *  every field that is wrong, from `where` down, joined by "; ". */
function decode<T>(schema: z.ZodType<T>, v: unknown, where: string): T {
    const parsed = schema.safeParse(v);
    if (parsed.success) return parsed.data;
    throw new Unexpected(parsed.error.issues.map(issue => answered(issue, v, where)).join('; '));
}

/** Returns what `issue` found in `v`, naming the field from `where` down
 *  and what came instead: "the registry answered submissions[0].byteSize
 *  as string, not a number". */
function answered(issue: z.core.$ZodIssue, v: unknown, where: string): string {
    const field = fieldOf(issue.path, where);
    const got = issue.path.reduce<unknown>((o, k) => (typeof o === 'object' && o !== null ? (o as Record<PropertyKey, unknown>)[k] : undefined), v);
    if (issue.code === 'invalid_value') return `the registry answered ${field} as ${JSON.stringify(got)}, not a role`;
    const expected = issue.code === 'invalid_type' ? issue.expected : 'value';
    const name = nameOf(expected);
    return expected === 'object' || expected === 'array'
        ? `the registry answered ${field} as something other than ${name}`
        : `the registry answered ${field} as ${typeof got}, not ${name}`;
}

/** Returns `v` as a `Me`, or throws `Unexpected` naming the field. */
export const decodeMe = (v: unknown, where = 'me'): Me => decode(me, v, where);
/** Returns `v` as an `Edition`, or throws `Unexpected` naming the field. */
export const decodeEdition = (v: unknown, where = 'edition'): Edition => decode(edition, v, where);
/** Returns `v` as a `Project`, or throws `Unexpected` naming the field. */
export const decodeProject = (v: unknown, where = 'project'): Project => decode(project, v, where);
/** Returns `v` as a `Submission`, or throws `Unexpected` naming the field. */
export const decodeSubmission = (v: unknown, where = 'submission'): Submission => decode(submission, v, where);
/** Returns `v` as a `Release`, or throws `Unexpected` naming the field. */
export const decodeRelease = (v: unknown, where = 'release'): Release => decode(release, v, where);
/** Returns `v` as a `Member`, or throws `Unexpected` naming the field. */
export const decodeMember = (v: unknown, where = 'member'): Member => decode(member, v, where);
/** Returns `v` as an `Accepted`, or throws `Unexpected` naming the field. */
export const decodeAccepted = (v: unknown, where = 'submission'): Accepted => decode(accepted, v, where);
/** Returns `v` as a `Published`, or throws `Unexpected` naming the field. */
export const decodePublished = (v: unknown, where = 'release'): Published => decode(published, v, where);
/** Returns `v` as an `AuthConfig`, or throws `Unexpected` naming the field. */
export const decodeAuthConfig = (v: unknown, where = 'auth config'): AuthConfig => decode(authConfig, v, where);

/** Returns a decoder of a list whose items `item` decodes, each named
 *  `where[i]` in an error. */
export const decodeList =
    <T>(item: (v: unknown, where: string) => T, where: string) =>
    (v: unknown): T[] => {
        if (!Array.isArray(v)) throw new Unexpected(`the registry answered ${where} as something other than a list`);
        return v.map((x: unknown, i) => item(x, `${where}[${i}]`));
    };
