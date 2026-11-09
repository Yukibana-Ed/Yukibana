/**
 * SPDX-License-Identifier: MIT
 */
import { Emitter, Event } from '@theia/core/lib/common';
import URI from '@theia/core/lib/common/uri';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { ConfigProvider } from '../config/config-provider';

/** Says which file is the assignment: the config's `assignmentFile`, in the first workspace root. */
@injectable()
export class AssignmentResolver {
    /** The workspace whose first root the assignment file is resolved against. */
    @inject(WorkspaceService) protected readonly workspace!: WorkspaceService;
    /** The config whose `assignmentFile` names the assignment. */
    @inject(ConfigProvider) protected readonly configProvider!: ConfigProvider;

    /** The emitter behind {@link onDidChange}. */
    protected readonly onDidChangeEmitter = new Emitter<void>();
    /**
     * The event fired whenever what {@link resolve} returns may have changed: on every change of workspace and every
     * config applied, including one identical to the last. It carries nothing; call {@link resolve} again.
     */
    readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;

    /** Subscribes to the workspace and the config for {@link onDidChange}, for the resolver's lifetime. */
    @postConstruct()
    protected init(): void {
        this.workspace.onWorkspaceChanged(() => this.onDidChangeEmitter.fire());
        this.configProvider.onConfigChanged(() => this.onDidChangeEmitter.fire());
    }

    /**
     * Returns the URI of the assignment file, or `undefined` iff the workspace has no root (no folder is open).
     *
     * The file may not exist: nothing is read. The name is the config as it is now, so `ASSIGNMENT.md` until
     * {@link ConfigProvider} has loaded one, and it is resolved against the first root without checking that it stays
     * inside it. Never rejects.
     */
    async resolve(): Promise<URI | undefined> {
        const root = this.workspace.tryGetRoots()[0]?.resource;
        if (!root) {
            return undefined;
        }
        const name = this.configProvider.config.assignmentFile;
        return root.resolve(name);
    }
}
