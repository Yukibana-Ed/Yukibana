/**
 * SPDX-License-Identifier: MIT
 */
import { DisposableCollection } from '@theia/core';
import { WindowFocusService } from '@theia/core/lib/browser/window/window-focus-service';
import { inject, injectable } from '@theia/core/shared/inversify';
import { EditorManager } from '@theia/editor/lib/browser';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { ClientToServer } from '@yukibana/telemetry-protocol';
import { LiveTelemetrySourceContribution } from '../../common/telemetry-protocol';
import { LiveTelemetryJournal } from '../live-telemetry-journal';

@injectable()
export class WorkbenchStateSource implements LiveTelemetrySourceContribution {
    @inject(LiveTelemetryJournal) protected readonly journal!: LiveTelemetryJournal;
    @inject(WindowFocusService) protected readonly focus!: WindowFocusService;
    @inject(EditorManager) protected readonly editors!: EditorManager;
    @inject(WorkspaceService) protected readonly workspace!: WorkspaceService;

    protected readonly toDispose = new DisposableCollection();

    start(): void {
        this.toDispose.push(this.focus.onDidWindowChangeFocus(() => this.sendState()));
        this.toDispose.push(this.editors.onCurrentEditorChanged(() => this.sendState()));
        this.toDispose.push(this.editors.onCreated(() => this.sendState()));
    }

    dispose(): void {
        this.toDispose.dispose();
    }

    protected async sendState(): Promise<void> {
        this.journal.record({
            type: 'state',
            focused: this.focus.hasFocus,
            activeFile: await this.getActiveFile(),
            openFiles: await this.getOpenFiles(),
        } satisfies ClientToServer.State);
    }

    protected async getActiveFile(): Promise<string | undefined> {
        const uri = this.editors.currentEditor?.editor.uri;
        if (!uri) {
            return undefined;
        }
        return this.workspace.getWorkspaceRelativePath(uri);
    }

    protected getOpenFiles(): Promise<string[]> {
        const uris = this.editors.all.map(w => w.editor.uri);
        return Promise.all(uris.map(u => this.workspace.getWorkspaceRelativePath(u)));
    }
}
