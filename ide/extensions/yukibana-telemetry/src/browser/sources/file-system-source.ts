import { Disposable, DisposableCollection, Emitter, ILogger, URI } from '@theia/core';
import { inject, injectable, named } from '@theia/core/shared/inversify';
import { FileService, UserFileOperationEvent } from '@theia/filesystem/lib/browser/file-service';
import { FileChangesEvent, FileChangeType, FileOperation, FileOperationEvent } from '@theia/filesystem/lib/common/files';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { ClientToServer } from '@yukibana/telemetry-protocol';
import { LiveTelemetrySourceContribution } from '../../common/telemetry-protocol';
import { LiveTelemetryJournal } from '../live-telemetry-journal';

const FILE_OPERATION_TYPES: Record<FileOperation, 'create' | 'rename' | 'delete' | 'change'> = {
    [FileOperation.CREATE]: 'create',
    [FileOperation.MOVE]: 'rename',
    [FileOperation.DELETE]: 'delete',
    [FileOperation.COPY]: 'create',
};
const CHANGE_TYPES: Record<FileChangeType, 'create' | 'rename' | 'delete' | 'change'> = {
    [FileChangeType.ADDED]: 'create',
    [FileChangeType.DELETED]: 'delete',
    [FileChangeType.UPDATED]: 'change',
};
const MAX_PENDING_MS = 200;

type OperationSource = 'user' | 'ide' | 'disk';

interface IDEOperation {
    by: 'user' | 'ide';
    op: FileOperation;
    uri: URI;
    newURI?: URI;
}

interface DiskOperation {
    by: 'disk';
    op: FileChangeType;
    uri: URI;
}

interface PendingOperation {
    operation: IDEOperation | DiskOperation;
    emittedAt: number;
}

interface ResolvedOperation {
    op: 'create' | 'rename' | 'delete' | 'change';
    uri: URI;
    newURI?: URI;
    by: OperationSource;
}

class FileOperationGrouper implements Disposable {
    protected pending: PendingOperation[] = [];
    protected toDispose = new DisposableCollection();

    protected readonly onOperationEmitter = new Emitter<ResolvedOperation>();
    readonly onOperation = this.onOperationEmitter.event;

    dispose(): void {
        this.toDispose.dispose();
        this.pending = [];
    }

    pushOperation(operation: IDEOperation | DiskOperation) {
        this.pending.push({
            operation,
            emittedAt: Date.now(),
        });
        const timeout = setTimeout(() => this.flush(), 2 * MAX_PENDING_MS);
        this.toDispose.push({ dispose: () => clearTimeout(timeout) });
    }

    getExpired(): { user: IDEOperation[]; ide: IDEOperation[]; disk: DiskOperation[] } {
        const expired: { user: IDEOperation[]; ide: IDEOperation[]; disk: DiskOperation[] } = {
            user: [],
            ide: [],
            disk: [],
        };
        const pending: PendingOperation[] = [];
        const now = Date.now();
        for (const pendingOp of this.pending) {
            if (now - pendingOp.emittedAt > MAX_PENDING_MS) {
                const op = pendingOp.operation;
                // Typing workaround for correlated union
                // see https://github.com/microsoft/TypeScript/issues/30581
                if (op.by === 'disk') {
                    expired[op.by].push(op);
                } else {
                    expired[op.by].push(op);
                }
            } else {
                pending.push(pendingOp);
            }
        }
        this.pending = pending;
        return expired;
    }

    protected expectedDiskChanges(operation: IDEOperation): [string, FileChangeType][] {
        switch (operation.op) {
            case FileOperation.CREATE:
                return [[operation.uri.toString(), FileChangeType.ADDED]];

            case FileOperation.DELETE:
                return [[operation.uri.toString(), FileChangeType.DELETED]];

            case FileOperation.MOVE:
                return [
                    [operation.uri.toString(), FileChangeType.DELETED],
                    [operation.newURI!.toString(), FileChangeType.ADDED],
                ];

            case FileOperation.COPY:
                return [[operation.newURI!.toString(), FileChangeType.ADDED]];
        }
    }

    protected flush() {
        const operations = this.getExpired();
        const toResolve: (IDEOperation | DiskOperation)[] = [];
        const expectedDiskChanges = new Map<string, Set<FileChangeType>>();

        const nonDiskOperations: [string, string | undefined, FileOperation][] = [];

        // Add all user operations and record expected disk changes
        for (const operation of operations.user) {
            for (const [uri, changeType] of this.expectedDiskChanges(operation)) {
                if (!expectedDiskChanges.has(uri)) {
                    expectedDiskChanges.set(uri, new Set());
                }
                expectedDiskChanges.get(uri)!.add(changeType);
            }
            nonDiskOperations.push([operation.uri.toString(), operation.newURI?.toString(), operation.op]);
            toResolve.push(operation);
        }

        // Add all ide operations not covered by user operations
        // and record expected disk changes
        for (const operation of operations.ide) {
            const opKey: [string, string | undefined, FileOperation] = [operation.uri.toString(), operation.newURI?.toString(), operation.op];
            // Skip if covered by user operation
            let alreadyCovered = false;
            for (const [uri, newURI, opType] of nonDiskOperations) {
                if (uri !== opKey[0]) {
                    continue;
                }
                if (newURI !== opKey[1]) {
                    continue;
                }
                if (opType !== opKey[2]) {
                    continue;
                }
                alreadyCovered = true;
                break;
            }
            if (alreadyCovered) {
                continue;
            }

            for (const [uri, changeType] of this.expectedDiskChanges(operation)) {
                if (!expectedDiskChanges.has(uri)) {
                    expectedDiskChanges.set(uri, new Set());
                }
                expectedDiskChanges.get(uri)!.add(changeType);
            }
            nonDiskOperations.push(opKey);
            toResolve.push(operation);
        }

        // Add all unexpected disk changes
        for (const operation of operations.disk) {
            const expectedChanges = expectedDiskChanges.get(operation.uri.toString());
            if (!expectedChanges?.has(operation.op)) {
                toResolve.push(operation);
            }
        }

        // Fire event emitter with filtered operations
        for (const operation of toResolve) {
            const resolved = this.resolveOperation(operation);
            this.onOperationEmitter.fire(resolved);
        }
    }

    protected resolveOperation(operation: IDEOperation | DiskOperation): ResolvedOperation {
        const op = operation.by === 'disk' ? CHANGE_TYPES[operation.op] : FILE_OPERATION_TYPES[operation.op];
        return {
            by: operation.by,
            op: op,
            uri: operation.uri,
            newURI: operation.by === 'user' || operation.by === 'ide' ? operation.newURI : undefined,
        };
    }
}

@injectable()
export class FileSystemSource implements LiveTelemetrySourceContribution {
    @inject(LiveTelemetryJournal) protected readonly journal!: LiveTelemetryJournal;
    @inject(FileService) protected readonly files!: FileService;
    @inject(WorkspaceService) protected readonly workspace!: WorkspaceService;
    @inject(ILogger) @named('yukibana:FileSystemSource') protected readonly logger!: ILogger;

    protected readonly toDispose = new DisposableCollection();
    protected readonly grouper = new FileOperationGrouper();

    start(): void {
        this.toDispose.push(this.files.onDidRunOperation(e => this.onFileOperation(e)));
        this.toDispose.push(this.files.onDidRunUserOperation(e => this.onUserFileOperation(e)));
        this.toDispose.push(this.files.onDidFilesChange(e => this.onFileChange(e)));
        this.toDispose.push(
            this.grouper.onOperation(async op => {
                const path = await this.workspace.getWorkspaceRelativePath(op.uri);
                const newPath = op.newURI !== undefined ? await this.workspace.getWorkspaceRelativePath(op.newURI) : undefined;
                this.journal.record({
                    type: 'file-op',
                    op: op.op,
                    path: path,
                    newPath: newPath,
                    by: op.by,
                } satisfies ClientToServer.FileOp);
            }),
        );
    }

    dispose(): void {
        this.toDispose.dispose();
        this.grouper.dispose();
    }

    protected async onFileOperation(operation: FileOperationEvent): Promise<void> {
        this.grouper.pushOperation({
            by: 'ide',
            op: operation.operation,
            uri: operation.resource,
            newURI: operation.operation === FileOperation.MOVE || operation.operation === FileOperation.COPY ? operation.target?.resource : undefined,
        });
    }

    protected async onUserFileOperation(operation: UserFileOperationEvent): Promise<void> {
        this.grouper.pushOperation({
            by: 'user',
            op: operation.operation,
            uri: operation.source ?? operation.target,
            newURI: (operation.operation === FileOperation.MOVE || operation.operation === FileOperation.COPY) && operation.source !== undefined ? operation.target : undefined,
        });
    }

    protected onFileChange(event: FileChangesEvent): void {
        for (const change of event.changes) {
            this.grouper.pushOperation({
                by: 'disk',
                op: change.type,
                uri: change.resource,
            });
        }
    }
}
