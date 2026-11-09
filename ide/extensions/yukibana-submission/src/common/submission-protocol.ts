/**
 * SPDX-License-Identifier: MIT
 */
/** The RPC path the backend serves {@link SubmissionService} at, and the frontend's proxy connects to. */
export const submissionServicePath = '/services/yukibana/submission';
/** The key {@link SubmissionService} is bound under: `SubmissionServiceImpl` in the backend, an RPC proxy to it in the frontend. */
export const SubmissionService = Symbol('SubmissionService');

/** A file a submission holds, as its preview lists it. */
export interface SubmissionEntry {
    /** Relative to the workspace root, forward slashes. */
    readonly path: string;
    /** Bytes, uncompressed; 0 for a symbolic link. */
    readonly size: number;
}

/**
 * A submission made from the workspace and held by the backend until it is released, as the student checks it
 * before sending: exactly what will be sent, by the same rules as `yukibana submit`.
 */
export interface SubmissionPreview {
    /** Names the submission to `save`, `release` and the submission targets. */
    readonly id: string;
    /** The project the workspace's `yukibana.json` names, if any. */
    readonly projectId: string | null;
    /** What will be sent, in archive order. */
    readonly entries: readonly SubmissionEntry[];
    /** What the rules leave out; a folder left out whole is listed once, as `path/`. */
    readonly skipped: readonly string[];
    /** Reasons it must not be sent, in sentences; it may be sent iff there are none. */
    readonly problems: readonly string[];
    /** The sum of the entries' sizes, uncompressed. */
    readonly totalSize: number;
}

/**
 * Makes submissions of a workspace in the backend and holds them until they are released, so the frontend can show
 * one, and a target send or save it, without the files crossing to the frontend.
 */
export interface SubmissionService {
    /**
     * Makes a submission of the workspace `workspaceUri`, holds it in memory, and returns its preview.
     *
     * Rejects, saying why, when the workspace has no valid `yukibana.json`; rejects too when a file in it cannot be
     * read, and when `workspaceUri` is not a `file:` URI (the backend reads its own disk). Nothing is written to disk.
     * A submission with `problems` still resolves, and is held.
     */
    prepare(workspaceUri: string): Promise<SubmissionPreview>;
    /**
     * Writes the archive of submission `id`, a `.tar.gz`, to `destinationUri`, and returns `false` iff no such
     * submission is held. Rejects when `destinationUri` is not a `file:` URI (the backend writes to its own disk), or
     * when the file cannot be written.
     */
    save(id: string, destinationUri: string): Promise<boolean>;
    /** Forgets submission `id`; a caller of `prepare` releases what it prepared once it is done with it. */
    release(id: string): Promise<void>;
}
