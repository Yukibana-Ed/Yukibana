/**
 * SPDX-License-Identifier: MIT
 */
import { ILogger, URI } from '@theia/core';
import { inject, injectable, named } from '@theia/core/shared/inversify';
import {
    createFileSystemProviderError,
    FileDeleteOptions,
    FileOverwriteOptions,
    FilePermission,
    FileSystemProviderErrorCode,
    FileWriteOptions,
    Stat,
} from '@theia/filesystem/lib/common/files';
import { RemoteFileSystemProvider } from '@theia/filesystem/lib/common/remote-file-system-provider';
import { ReadOnlyPolicy } from './config/read-only-policy';

/**
 * The frontend's file system provider, which refuses to change the files {@link ReadOnlyPolicy} names and reports them
 * as read-only, so the editor opens them read-only.
 *
 * It guards `writeFile`, `delete` and `rename` only, and only in this frontend: `open`/`write` handles, `copy`,
 * `mkdir` and `updateFile` go through, and the backend still writes whatever it is asked to. `delete` and `rename`
 * check only the paths they are given, not what is under them, so a recursive delete or a rename of a directory above
 * read-only files (`src` when `src/test/**` is read-only) is not refused. It keeps the student from
 * changing a file by accident; the assembly of a submission, which replaces read-only files with the teacher's, is
 * what makes the rule hold.
 */
@injectable()
export class YukibanaRemoteFileSystemProvider extends RemoteFileSystemProvider {
    /** Says which files are read-only. */
    @inject(ReadOnlyPolicy) protected readonly readOnlyPolicy!: ReadOnlyPolicy;
    /** Says when the provider is initialized. */
    @inject(ILogger) @named('yukibana:RemoteFileSystemProvider') protected readonly logger!: ILogger;

    /** Initializes as Theia does, and logs that it has. */
    protected override init(): void {
        super.init();
        this.logger.info('Initialized');
    }

    /** Returns `true` iff {@link ReadOnlyPolicy} says `resource` is read-only now. */
    protected isFileReadonly(resource: URI): boolean {
        return this.readOnlyPolicy.isFileReadonly(resource);
    }

    /**
     * Returns iff `resource` is not read-only.
     *
     * Throws a `FileSystemProviderError` with code `NoPermissions` and a message naming the file's base name otherwise.
     */
    assertWritable(resource: URI): void {
        if (this.isFileReadonly(resource)) {
            throw createFileSystemProviderError(`"${resource.path.base}" cannot be modified`, FileSystemProviderErrorCode.NoPermissions);
        }
    }

    /**
     * Returns the file's stat as Theia does, with `permissions` set to `Readonly` when {@link ReadOnlyPolicy} names it; a
     * file the backend already reports as read-only stays so.
     */
    override async stat(resource: URI): Promise<Stat> {
        const stat = await super.stat(resource);
        return this.isFileReadonly(resource) ? { ...stat, permissions: FilePermission.Readonly } : stat;
    }

    /** Writes `content` to `resource` as Theia does; rejects with {@link assertWritable}'s error if it is read-only. */
    override async writeFile(resource: URI, content: Uint8Array, opts: FileWriteOptions): Promise<void> {
        this.assertWritable(resource);
        return super.writeFile(resource, content, opts);
    }

    /** Deletes `resource` as Theia does; rejects with {@link assertWritable}'s error if it is read-only. */
    override async delete(resource: URI, opts: FileDeleteOptions): Promise<void> {
        this.assertWritable(resource);
        return super.delete(resource, opts);
    }

    /** Moves `resource` to `target` as Theia does; rejects with {@link assertWritable}'s error if either is read-only. */
    override async rename(resource: URI, target: URI, opts: FileOverwriteOptions): Promise<void> {
        this.assertWritable(resource);
        this.assertWritable(target);
        return super.rename(resource, target, opts);
    }
}
