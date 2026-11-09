/**
 * SPDX-License-Identifier: MIT
 */
import URI from '@theia/core/lib/common/uri';
import { FileUri } from '@theia/core/lib/node';
import { injectable } from '@theia/core/shared/inversify';
import { createSubmissionBundle, SubmissionBundle } from '@yukibana/client';
import { randomUUID } from 'crypto';
import * as fs from 'fs';
import { SubmissionPreview, SubmissionService } from '../common/submission-protocol';

/**
 * Submissions packed by `@yukibana/client`, so the IDE sends exactly the files `yukibana submit` would, held in memory
 * under an id from `prepare` until `release`. Nothing is written to disk unless `save` is asked to.
 */
@injectable()
export class SubmissionServiceImpl implements SubmissionService {
    /** The submissions held, by the id `prepare` gave them; an entry lives until `release`, for as long as the backend runs. */
    protected readonly prepared = new Map<string, SubmissionBundle>();

    /**
     * Makes a submission of the folder `workspaceUri` and holds it under a new random UUID (see {@link SubmissionService.prepare}).
     *
     * - Requires: `workspaceUri` is a `file:` URI. Rejects otherwise, before reading anything: `FileUri.fsPath` would
     *   take the path part of any URI and read that path from this machine's disk.
     *
     * Rejects, with the reasons joined by `; `, when the folder has no valid `yukibana.json`; rejects too when a file in
     * it cannot be read. A submission with `problems` is still held and returned.
     */
    async prepare(workspaceUri: string): Promise<SubmissionPreview> {
        requireFileUri(workspaceUri);
        const made = await createSubmissionBundle(FileUri.fsPath(workspaceUri));
        if (!made.ok) {
            throw new Error(made.problems.join('; '));
        }
        const { bundle } = made;
        const id = randomUUID();
        this.prepared.set(id, bundle);
        return {
            id,
            projectId: bundle.projectId,
            entries: bundle.files.map(f => ({ path: f.path, size: f.size })),
            skipped: bundle.skipped,
            problems: bundle.problems,
            totalSize: bundle.totalBytes,
        };
    }

    /** Returns submission `id` as `prepare` made it, or `undefined` once it is released. */
    bundle(id: string): SubmissionBundle | undefined {
        return this.prepared.get(id);
    }

    /**
     * Writes submission `id`'s gzipped tar to `destinationUri`, replacing any file there, and returns `false` iff no
     * such submission is held. Rejects when the file cannot be written. Does not release it.
     *
     * - Requires: `destinationUri` is a `file:` URI. Rejects otherwise, before anything is written, for the reason
     *   {@link prepare} does.
     */
    async save(id: string, destinationUri: string): Promise<boolean> {
        requireFileUri(destinationUri);
        const bundle = this.bundle(id);
        if (bundle === undefined) {
            return false;
        }
        await fs.promises.writeFile(FileUri.fsPath(destinationUri), await bundle.archive());
        return true;
    }

    /** Forgets submission `id`; releasing one that is not held does nothing. */
    async release(id: string): Promise<void> {
        this.prepared.delete(id);
    }
}

/** Throws an `Error` naming `uri` unless its scheme is `file`. */
function requireFileUri(uri: string): void {
    const scheme = new URI(uri).scheme;
    if (scheme !== 'file') {
        throw new Error(`Expected a file: URI, got ${JSON.stringify(uri)}`);
    }
}
