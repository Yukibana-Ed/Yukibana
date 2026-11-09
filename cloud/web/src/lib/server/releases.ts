/** Publishing a release and handing out its archives. The same function
 *  serves CI (a project token) and the CLI as a person (their access
 *  token), so both make the same decisions in the same order: check the
 *  archives, store both, then record the row under the caller's policies;
 *  a refused row, or a bucket that fails part way, deletes both objects
 *  again.
 */

import { error, isHttpError } from '@sveltejs/kit';
import type { Claims } from '#lib/claims.ts';
import { isGzip, sha256 } from '#lib/bytes.ts';
import { starterKey, teacherKey, trustId, trustKey, type ProjectId, type ReleaseId } from '#lib/ids.ts';
import { report } from '#lib/report.ts';
import { asPublisher, asUser, Misconfigured, statusOf } from './db';
import type { BucketObject, Context } from './context';

/** One archive of a release, as bytes. Nothing in the app uses it any
 *  more: `publishRelease` takes the two archives as plain `Uint8Array`s. */
export interface Archive {
    /** The archive's bytes, a .tar.gz. */
    readonly bytes: Uint8Array;
}

/** What a publish recorded, for the publisher to check against what it
 *  sent. */
export interface Published {
    /** The release's id: the one the publisher chose, or the database's. */
    readonly releaseId: ReleaseId;
    /** The starter as stored: its size in bytes and its SHA-256 as 64
     *  lowercase hex digits. */
    readonly starter: { readonly size: number; readonly sha256: string };
    /** The teacher archive as stored, likewise. */
    readonly teacher: { readonly size: number; readonly sha256: string };
}

/** Who is publishing: a person (on the page, or the CLI with their access
 *  token), or a project token from CI. */
export type Publisher =
    | {
          /** A person, on the page or through the CLI with their own access
           *  token, publishing under their own policies. */
          readonly kind: 'user';
          /** Their verified claims. */
          readonly claims: Claims;
      }
    | {
          /** A project token. */
          readonly kind: 'token';
          /** The token's secret as the request carried it; only its SHA-256
           *  reaches the database, and it is never logged. */
          readonly secret: string;
      };

const hex = (b: Uint8Array): string => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');

/** The token's SHA-256, which is all the database ever sees of it. */
async function tokenHash(secret: string): Promise<Uint8Array> {
    return sha256(new TextEncoder().encode(secret));
}

/** Publishes `starter` and `teacher` as a release of `project`, or throws the
 *  HTTP error that says why not. Every failure is one: a database or bucket
 *  failure is reported and answered as a 500 that carries its code and not
 *  its message, and a connection that cannot become its role as a 500 that
 *  says so (see `refuse`). Whatever fails after the first object is
 *  written, both objects are deleted again, and an object that cannot be
 *  deleted is reported as orphaned. Before anything is stored: an empty
 *  archive or a `commit` that is not 7 to 64 hex digits is a 400, one over
 *  `releaseMaxBytes` a 413, one that is not gzip a 415; a token that does
 *  not name `project`, or a person who may not edit its projects, is a 403.
 *  `label` is passed to the database as it is, which decides what it takes.
 *
 *  `release` is the id the publisher chose and wrote into the starter's
 *  yukibana.json, so a student's folder says which release it is; the row
 *  gets exactly that id or is not written. An id already taken, by this
 *  project or any other, is a 409 and both objects are deleted again. Null
 *  lets the database choose, for archives that carry no id; their
 *  submissions then record no base. */
export async function publishRelease(
    ctx: Context,
    by: Publisher,
    project: ProjectId,
    starter: Uint8Array,
    teacher: Uint8Array,
    label: string,
    commit: string | null,
    release: ReleaseId | null,
): Promise<Published> {
    for (const [name, bytes] of [
        ['starter', starter],
        ['teacher', teacher],
    ] as const) {
        if (bytes.byteLength === 0) error(400, `The ${name} archive is empty.`);
        if (bytes.byteLength > ctx.config.releaseMaxBytes) error(413, `The ${name} archive is larger than ${ctx.config.releaseMaxBytes} bytes.`);
        if (!isGzip(bytes)) error(415, `The ${name} archive is not gzip; a release is two .tar.gz files.`);
    }
    if (commit !== null && !/^[0-9a-f]{7,64}$/i.test(commit)) error(400, 'A commit is a hex sha.');

    // Both of these ask the database who the caller is, and both used to do it
    // outside the mapping below: a token that could not be looked up at all
    // reached the CLI as a bare 500 with nothing in it, which is how a Worker
    // connected as the wrong role looked for a day.
    const hash = by.kind === 'token' ? await tokenHash(by.secret) : null;
    try {
        if (hash !== null) {
            const named = await asPublisher(ctx.sql, async tx => {
                const [row] = await tx<{ project: string | null }[]>`select app.project_for_token(${hash as Uint8Array<ArrayBuffer>}) as project`;
                return row?.project ?? null;
            });
            if (named !== project) error(403, 'This token does not publish to this project.');
        } else if (by.kind === 'user') {
            const allowed = await asUser(ctx.sql, by.claims, async tx => {
                const rows = await tx`select 1 from project where project_id = ${project} and app.may_edit_projects(edition_id)`;
                return rows.length === 1;
            });
            if (!allowed) error(403, 'Only staff may publish a release.');
        }
    } catch (e) {
        refuse(e);
    }

    const object = crypto.randomUUID();
    const keys = { starter: starterKey(project, object), teacher: teacherKey(project, object) };
    const digests = { starter: await sha256(starter), teacher: await sha256(teacher) };

    try {
        // Inside the try, so a bucket that fails the second put does not leave
        // the first object behind unreported: the cleanup below deletes both
        // keys, and deleting one that was never written is not an error.
        await ctx.bucket.put(keys.starter, starter, 'application/gzip');
        await ctx.bucket.put(keys.teacher, teacher, 'application/gzip');
        const args = [
            release,
            label,
            commit,
            keys.starter,
            starter.byteLength,
            digests.starter as Uint8Array<ArrayBuffer>,
            keys.teacher,
            teacher.byteLength,
            digests.teacher as Uint8Array<ArrayBuffer>,
        ] as const;
        const id =
            hash !== null
                ? await asPublisher(ctx.sql, async tx => {
                      const [row] = await tx<
                          { id: string }[]
                      >`select app.publish_release_with_token(${hash as Uint8Array<ArrayBuffer>}, ${args[0]}::uuid, ${args[1]}, ${args[2]}, ${args[3]}, ${args[4]}, ${args[5]}, ${args[6]}, ${args[7]}, ${args[8]}) as id`;
                      return row?.id ?? null;
                  })
                : await asUser(ctx.sql, (by as { claims: Claims }).claims, async tx => {
                      const [row] = await tx<
                          { id: string }[]
                      >`select app.publish_release(${project}, ${args[0]}::uuid, ${args[1]}, ${args[2]}, ${args[3]}, ${args[4]}, ${args[5]}, ${args[6]}, ${args[7]}, ${args[8]}) as id`;
                      return row?.id ?? null;
                  });
        if (id === null) throw new Error('publish returned nothing');
        return {
            releaseId: trustId<ReleaseId>(id),
            starter: { size: starter.byteLength, sha256: hex(digests.starter) },
            teacher: { size: teacher.byteLength, sha256: hex(digests.teacher) },
        };
    } catch (e) {
        for (const key of [keys.starter, keys.teacher]) {
            try {
                await ctx.bucket.delete(key);
            } catch (inner) {
                report('releases', `orphaned ${key}: ${inner instanceof Error ? inner.message : String(inner)}`);
            }
        }
        refuse(e);
    }
}

/** Answers a failed database call, always by throwing.
 *
 *  A SvelteKit error is already the answer and passes through. A connection
 *  that cannot become its role says so in full, because only an operator can
 *  fix it and a generic sentence sends them looking in the wrong place.
 *  Anything else the database refused says what the migration wrote, which
 *  those messages exist to be. An unexpected failure is written down and
 *  answered with its code and nothing more (`statusOf`'s: the SQLSTATE, or
 *  a client or system code such as `ECONNREFUSED`): the message may quote
 *  the query, and the code is enough to say where to look. */
function refuse(e: unknown): never {
    if (isHttpError(e)) throw e;
    if (e instanceof Misconfigured) error(500, e.message);
    const { status, message, code } = statusOf(e);
    // The one conflict publishing can meet. Said in words, because the likely
    // reader is CI retrying a publish whose first attempt did land: the
    // release it wanted is there, under this id, in this project or another.
    if (code === '23505') error(409, 'A release with this id has already been published; a retry of the same publish has nothing left to do.');
    if (status !== 500) error(status, message);
    report('releases', message);
    error(500, `The release could not be recorded${code === '' ? '' : ` (code ${code})`}; the Worker log says why.`);
}

/** The object of one archive of `release` (`starter` or `teacher`), if the
 *  caller may read it, and the name a download of it is saved as:
 *  `<slug>-<archive>[-<label>].tar.gz`, where the label has each run of
 *  characters outside `[A-Za-z0-9._-]` replaced by one `_` and is left out
 *  when empty; or `release-<id>-<archive>.tar.gz` when the caller reads no
 *  release row (a student downloading the starter).
 *
 *  The teacher archive is for staff of the release's edition, and the
 *  release_read policy on the table is the check. The starter is also for a
 *  student of a project whose window is open, the merge base of an IDE's
 *  update, and `app.release_starter` is the check: a student reads no
 *  release row, and must not, because the row carries the teacher
 *  archive's key. Either way an answer the caller may not have is a 404,
 *  the same as for an id that names nothing. */
export async function releaseObject(ctx: Context, claims: Claims, release: ReleaseId, archive: 'starter' | 'teacher'): Promise<BucketObject> {
    // A student reads no release row, so for them the joins find nothing:
    // no teacher key, and a download named after the release id
    const [row] = await asUser(
        ctx.sql,
        claims,
        tx => tx<{ starter_key: string | null; teacher_key: string | null; slug: string | null; label: string | null }[]>`
    select app.release_starter(${release}) as starter_key, r.teacher_key, p.slug, r.label
    from (select) one
    left join project_release r on r.release_id = ${release}
    left join project p on p.project_id = r.project_id`,
    );
    const key = archive === 'starter' ? row?.starter_key : row?.teacher_key;
    if (key === null || key === undefined) error(404, 'No such release.');
    const slug = row?.slug ?? undefined;
    const label = row?.label ?? '';
    const name = slug === undefined ? `release-${release}-${archive}` : `${slug}-${archive}${label === '' ? '' : `-${label.replace(/[^A-Za-z0-9._-]+/g, '_')}`}`;
    return { key: trustKey(key), filename: `${name}.tar.gz` };
}

/** Returns a presigned URL, valid for 60 seconds, for one archive of
 *  `release`, if the caller may read it (`releaseObject`). */
export async function releaseUrl(ctx: Context, claims: Claims, release: ReleaseId, archive: 'starter' | 'teacher'): Promise<URL> {
    const o = await releaseObject(ctx, claims, release, archive);
    return ctx.bucket.presignGet(o.key, 60, o.filename);
}
