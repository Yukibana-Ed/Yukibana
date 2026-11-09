/**
 * SPDX-License-Identifier: MIT
 */
import { URI } from '@theia/core/lib/common/uri';
import type { ChooseReason } from '@yukibana/client';

/**
 * Bringing a student's folder up to the newest release of its project.
 *
 * The folder's `yukibana.json` names the release it started from (the stamp). When the teacher
 * publishes a newer one, the update writes everything that needs no decision in one step:
 * protected files (read-only in either release) and files only the teacher changed, and moves the
 * stamp last. Files both changed keep the student's version and are left pending: the student
 * merges each in the merge editor, or keeps theirs. Every file the update writes is backed up
 * first, and one undo puts all of it back.
 *
 * The backend owns the disk and the network; the frontend draws and opens editors. Every path in
 * this protocol is relative to the workspace root, with forward slashes, and never leaves it.
 * Rows never name `yukibana.json`: the stamp is the update's own bookkeeping, not a file the
 * student acts on.
 */
export const updateServicePath = '/services/yukibana/update';
/** The injection key of {@link UpdateService}: the backend's one instance, and the frontend's proxy to it. */
export const UpdateService = Symbol('UpdateService');

/** The URI scheme of the read-only versions the diff and merge editors show. See {@link UpdateUri}. */
export const UPDATE_SCHEME = 'yukibana-update';

/** What every row says about its path. */
interface RowBase {
    /** The path, relative to the workspace root. */
    readonly path: string;
    /** Whether every version of the file involved is text, so that a diff or merge can show it. */
    readonly text: boolean;
    /** Whether the folder had a file at `path` when the row was planned. */
    readonly present: boolean;
}

/**
 * A path the update writes or deletes without asking the student.
 *
 * Invariant: `editedByStudent` and `newlyProtected` imply `protected`.
 */
export interface DecidedRow extends RowBase {
    /** `write` puts the teacher's version at `path`; `delete` removes the file there. */
    readonly kind: 'write' | 'delete';
    /** Whether the path is read-only in either release, so that the teacher's version wins whatever the student did. */
    readonly protected: boolean;
    /** Whether the student's copy differs from the release they started from, so that the update replaces their edit. */
    readonly editedByStudent: boolean;
    /**
     * Whether the path is read-only in the new release but was editable in the one the folder started from, so that
     * what the student did there was their work until now. Never true for `yukibana.json`.
     */
    readonly newlyProtected: boolean;
}

/** A path both sides changed, where the student's version stays until they settle it. */
export type PendingRow =
    /** An editable text file both changed: the merge editor joins them. */
    | (RowBase & {
          /** `merge`: the student settles it in the merge editor, against the release the folder started from. */
          readonly kind: 'merge';
      })
    /** A change no line merge can join: the student keeps theirs or takes the teacher's. */
    | (RowBase & {
          /** `choose`: the student keeps their version or takes the teacher's (which may be no file). */
          readonly kind: 'choose';
          /** Why no line merge can join the two. */
          readonly reason: ChooseReason;
      });

/** One path an update touches. */
export type UpdateRow = DecidedRow | PendingRow;

/** Returns `true` iff `row` is decided, that is, written or deleted without asking. */
export function isDecided(row: UpdateRow): row is DecidedRow {
    return row.kind === 'write' || row.kind === 'delete';
}

/** The paths of one update, by what happens to them. */
export interface UpdateRows {
    /** The paths written or deleted without asking, in the order they are applied. */
    readonly decided: readonly DecidedRow[];
    /** The paths left to the student, by path. */
    readonly pending: readonly PendingRow[];
}

/**
 * A newer release that would change the folder.
 *
 * Invariant: `decided` and `pending` are not both empty (a release that changes nothing the
 * student receives moves the stamp silently instead).
 */
export interface AvailableUpdate extends UpdateRows {
    /** The release the folder is on. */
    readonly from: string;
    /** The release the update brings the folder to. */
    readonly to: string;
    /** The project's title, as the registry has it. */
    readonly projectTitle: string;
}

/** The update applied last to the folder, while it can be undone. */
export interface LastUpdate extends UpdateRows {
    /** The release the folder was on before the update. */
    readonly from: string;
    /** The release the update brought the folder to. */
    readonly to: string;
    /** When the update was applied, ISO 8601. */
    readonly at: string;
}

/**
 * What the backend knows about a folder.
 *
 * Several can hold at once: an update applied earlier with files still pending, and a newer
 * one available on top of it. Invariant: `available` and `problem` are never both set.
 */
export interface UpdateState {
    /** The newer release the folder could be updated to, if there is one. */
    readonly available?: AvailableUpdate;
    /** The update applied last, if it can still be undone. */
    readonly last?: LastUpdate;
    /** The project's deadline, ISO 8601, if it has one and the registry was reached. */
    readonly deadline?: string;
    /** Why the registry could not be asked or a release not planned, if one of them failed. */
    readonly problem?: string;
    /** Whether this check found an interrupted update and put the student's files back. */
    readonly rolledBack: boolean;
}

/** The state of a folder that is not a published project's, or before anything was checked. */
export const NO_UPDATE: UpdateState = { rolledBack: false };

/** What {@link UpdateService.update} did. */
export type UpdateResult =
    /** The folder is on the release asked for. */
    | {
          /**
           * `updated`: the folder is on the release asked for, either because this update wrote the decided rows and
           * moved the stamp, or because it was already there.
           */
          readonly kind: 'updated';
          /** The folder's state after the update, as {@link UpdateService.check} would return it. */
          readonly state: UpdateState;
      }
    /** Nothing was written: these read-only files hold the student's edits, which the update replaces. */
    | {
          /** `confirm`: nothing was written. */
          readonly kind: 'confirm';
          /** The read-only files whose edits the update would replace and that `confirmed` did not name, in plan order. */
          readonly paths: readonly string[];
      }
    /** The update did not finish, or reading the folder's state afterwards failed, for `reason`. */
    | {
          /**
           * `failed`: whatever an unfinished update wrote was put back (unless `reason` says that failed too). Rarely,
           * the update was applied and saved and only reading the folder's state afterwards failed (moving a stamp, or
           * finding the IDE's configuration folder): the update then stays applied, and can be undone.
           */
          readonly kind: 'failed';
          /** Why, in a sentence for the student. */
          readonly reason: string;
      };

/** What {@link UpdateService.undo} did. */
export type UndoResult =
    /** The folder is as it was before the last update. */
    | {
          /** `undone`: every file is put back and the record of the update removed. */
          readonly kind: 'undone';
          /** The folder's state after the undo, as {@link UpdateService.check} would return it. */
          readonly state: UpdateState;
      }
    /** Nothing was restored: these files changed after the update, and restoring them loses that. */
    | {
          /** `confirm`: nothing was restored. */
          readonly kind: 'confirm';
          /** The paths changed since the update or resolution that last wrote them, sorted. */
          readonly paths: readonly string[];
      }
    /** The undo did not finish, or reading the folder's state afterwards failed, for `reason`. */
    | {
          /**
           * `failed`: there was no update to undo; or the files could not be compared with the update's record, and
           * nothing was restored; or some files could not be put back, and the record stays; or every file was put back
           * and the record removed, and only reading the folder's state afterwards failed.
           */
          readonly kind: 'failed';
          /** Why, in a sentence for the student; names every path that could not be put back. */
          readonly reason: string;
      };

/** What the student decided about a pending row. `teacher` and `delete` write; `keep` and `merged` only settle it. */
export type Resolution = 'teacher' | 'delete' | 'keep' | 'merged';

/** Which read-only version of a file a `yukibana-update:` URI names. */
export type UpdateSide =
    /** The file as it was just before the last update, from its backup. */
    | {
          /** `before`: the backup the last update took. */
          readonly kind: 'before';
      }
    /** The file in a release's starter. */
    | {
          /** `release`: a release's starter, as the registry serves it. */
          readonly kind: 'release';
          /**
           * The release's id, a UUID (any case).
           *
           * Nothing over the RPC connection guarantees the shape: {@link UpdateService.read} rejects a `release` that is
           * not a UUID, since the id names a file in the IDE's cache.
           */
          readonly release: string;
      };

/**
 * The backend's half of assignment updates. Every `workspace` is the `file:` URI of a workspace root.
 *
 * Calls to {@link check}, {@link update}, {@link resolve} and {@link undo} on one workspace run one after another,
 * each after the previous one settled. {@link read} is not queued and may run while one of them is under way.
 */
export interface UpdateService {
    /**
     * Returns the state of `workspace`, asking the registry for its newest release.
     *
     * Rolls back an interrupted update first, and moves the stamp without asking when nothing else would change.
     */
    check(workspace: string): Promise<UpdateState>;

    /**
     * Updates `workspace` to release `to`, replacing the student's edits to the read-only files in `confirmed`.
     *
     * An interrupted earlier update is rolled back first, whatever the answer. Answers `confirm`, writing nothing of
     * this update, while an edit to a read-only file is not in `confirmed`. Answers `updated`, writing nothing of this
     * update, when the folder is already on `to`; the stamp may still move then, as {@link check} moves it. Never
     * rejects: every failure is `failed`, after putting back what an unfinished update wrote. Rarely, `failed`
     * follows an update that was applied, when reading the folder's state afterwards fails (see {@link UpdateResult}).
     *
     * `to` is meant to be the release `check` offered, but is not compared with it: any release whose starter the
     * registry serves is planned and applied the same way, and the plan is made afresh, so a file saved since the
     * check is what the update sees.
     */
    update(workspace: string, to: string, confirmed: readonly string[]): Promise<UpdateResult>;

    /**
     * Settles the pending row at `path` of the last update with `resolution`, and returns the new state.
     *
     * When there is no such pending row (it was settled already, or there is no finished update), nothing is settled
     * and the call does what {@link check} does: an interrupted update is rolled back first and the stamp may move.
     * `teacher` writes the new release's file and `delete` removes the student's; both count as what the update left
     * there, for undo.
     * - Requires: `resolution` is `teacher` only for a row whose release has a file at `path`. Enforced: otherwise
     *   rejects, changing nothing.
     */
    resolve(workspace: string, path: string, resolution: Resolution): Promise<UpdateState>;

    /**
     * Puts back every file the last update touched, and the old stamp.
     *
     * Answers `confirm`, restoring nothing, when a file changed since the update and `force` is false, and `failed`
     * when there is no update to undo or anything else fails (see {@link UndoResult}). Never rejects.
     */
    undo(workspace: string, force: boolean): Promise<UndoResult>;

    /**
     * Returns the text of `path` in the version `side`, decoded as UTF-8, or `''` when that version has no file there
     * or `path` is not inside the workspace.
     *
     * Not queued behind the other calls: it may run while one of them on `workspace` is under way, and then reads
     * whatever is there at that moment.
     *
     * - Requires: a `release` side's `release` is a UUID. Enforced: otherwise rejects, reading nothing.
     *
     * Rejects when the release's starter cannot be had, or a backup the record names cannot be read.
     */
    read(workspace: string, side: UpdateSide, path: string): Promise<string>;
}

/**
 * `yukibana-update:/before/<path>?<workspace>` and `yukibana-update:/release/<id>/<path>?<workspace>`.
 * The path keeps the file's name and extension, so editors pick the language and title from it.
 */
export namespace UpdateUri {
    /** What a `yukibana-update:` URI names. */
    export interface Parts {
        /** The `file:` URI of the workspace root. */
        readonly workspace: string;
        /** Which version of the file. */
        readonly side: UpdateSide;
        /** The path, relative to `workspace`. */
        readonly path: string;
    }

    /** Returns the URI naming `parts`. */
    export function encode({ workspace, side, path }: Parts): URI {
        const prefix = side.kind === 'before' ? '/before' : `/release/${side.release}`;
        return new URI().withScheme(UPDATE_SCHEME).withPath(`${prefix}/${path}`).withQuery(workspace);
    }

    /** Returns what `uri` names, or `undefined` when it is not a URI {@link encode} makes. */
    export function decode(uri: URI): Parts | undefined {
        if (uri.scheme !== UPDATE_SCHEME || uri.query === '') {
            return undefined;
        }
        const match = /^\/(?:before|release\/([0-9a-fA-F-]{36}))\/(.+)$/.exec(uri.path.toString());
        if (!match) {
            return undefined;
        }
        const [, release, path] = match;
        return { workspace: uri.query, side: release === undefined ? { kind: 'before' } : { kind: 'release', release }, path: path! };
    }
}
