/**
 * SPDX-License-Identifier: MIT
 */
import { DisposableCollection, URI } from '@theia/core';
import { inject, injectable } from '@theia/core/shared/inversify';
import { EditorManager, EditorWidget } from '@theia/editor/lib/browser';
import { editor } from '@theia/monaco-editor-core';
import { MonacoEditor } from '@theia/monaco/lib/browser/monaco-editor';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { ClientToServer, EditOrigin } from '@yukibana/telemetry-protocol';
import { LiveTelemetrySourceContribution } from '../../common/telemetry-protocol';
import { EditOriginResolver, EditReason } from '../edit-origin-resolver';
import { LiveTelemetryClientImpl } from '../live-telemetry-client';
import { LiveTelemetryJournal } from '../live-telemetry-journal';

const CHECKPOINT_INTERVAL_MS = 30_000;

@injectable()
export class EditorEditSource implements LiveTelemetrySourceContribution {
    @inject(LiveTelemetryJournal) protected readonly journal!: LiveTelemetryJournal;
    @inject(LiveTelemetryClientImpl) protected readonly client!: LiveTelemetryClientImpl;
    @inject(EditOriginResolver) protected readonly originResolver!: EditOriginResolver;
    @inject(EditorManager) protected readonly editors!: EditorManager;
    @inject(WorkspaceService) protected readonly workspace!: WorkspaceService;

    protected readonly toDispose = new DisposableCollection();

    start(): void {
        this.toDispose.push(
            this.client.onCommand$(cmd => {
                if (cmd.type === 'resync') {
                    void this.sendSnapshot(cmd.file, 'resync');
                }
            }),
        );

        this.editors.all.map(w => this.attach(w));
        this.editors.onCreated(w => this.attach(w));

        const interval = setInterval(() => this.sendCheckpoints(), CHECKPOINT_INTERVAL_MS);
        this.toDispose.push({ dispose: () => clearInterval(interval) });
    }
    dispose(): void {
        this.toDispose.dispose();
    }

    /**
     * Reports every content change of the Monaco editor in `widget`, or does nothing if it has none.
     *
     * Reads `detailedReasons` and `detailedReasonsChangeLengths`. Only `detailedReasons` is missing from the public
     * `IModelContentChangedEvent` (Monaco declares it internally, in `textModelEvents`), hence the cast adding it; an
     * editor whose event lacks it throws on each change.
     */
    protected async attach(widget: EditorWidget): Promise<void> {
        const monaco = MonacoEditor.get(widget)?.getControl();
        if (!monaco) {
            return;
        }

        const listener = monaco.onDidChangeModelContent(async rawEvent => {
            const uri = monaco.getModel()?.uri;
            const path = await this.workspace.getWorkspaceRelativePath(new URI(uri?.toString()));
            const e = rawEvent as editor.IModelContentChangedEvent & { detailedReasons: EditReason[] };

            let changeIdx: number = 0;
            for (let i = 0; i < e.detailedReasons.length; i++) {
                const detailedReason = e.detailedReasons[i];
                const origin: EditOrigin = e.isUndoing ? 'undo' : e.isRedoing ? 'redo' : this.originResolver.originOfChange(detailedReason);
                const nChanges = e.detailedReasonsChangeLengths[i];
                const editChanges = e.changes.slice(changeIdx, changeIdx + nChanges);
                changeIdx += nChanges;
                // const command = origin === 'command' || origin === 'unknown' ? detailedReason.metadata?.detailedSource : undefined;
                // const name = origin === 'unknown' ? detailedReason.metadata?.name : undefined;
                // const totalDelta = editChanges.reduce((a, b) => a + b.text.length - b.rangeLength, 0);

                this.journal.record({
                    type: 'edit',
                    file: path,
                    version: e.versionId,
                    baseVersion: 0,
                    changes: editChanges.map(change => ({
                        length: change.rangeLength,
                        offset: change.rangeOffset,
                        text: change.text,
                    })),
                    origin: origin,
                } satisfies ClientToServer.Edit);
            }
        });
        this.toDispose.push(listener);
        this.toDispose.push(
            monaco.onDidChangeModel(async e => {
                if (e.newModelUrl !== null) {
                    const path = await this.workspace.getWorkspaceRelativePath(new URI(e.newModelUrl.toString()));
                    await this.sendSnapshot(path, 'open');
                }
            }),
        );
    }

    protected async sendSnapshot(path: string, reason: 'open' | 'external' | 'resync'): Promise<void> {
        const root = this.workspace.tryGetRoots()[0];
        if (root === undefined) {
            return;
        }
        const uri = root.resource.resolve(path);
        const widget = await this.editors.getByUri(uri);
        if (!widget) {
            return;
        }
        const editor = MonacoEditor.get(widget)?.getControl();
        if (!editor) {
            return;
        }
        const model = editor.getModel();
        if (!model) {
            return;
        }
        const text = model.getValue();
        const sha256 = await this.sha256(text);
        this.journal.record({
            type: 'snapshot',
            file: path,
            version: model.getVersionId(),
            text: text,
            eol: model.getEOL() as '\n' | '\r\n',
            sha256: sha256,
            reason: reason,
        } satisfies ClientToServer.Snapshot);
    }

    protected sendCheckpoints(): void {
        this.editors.all.forEach(widget => {
            this.sendCheckpoint(widget);
        });
    }

    protected async sendCheckpointForURI(uri: URI): Promise<void> {
        const widget = await this.editors.getByUri(uri);
        if (!widget) {
            return;
        }
        return this.sendCheckpoint(widget);
    }

    protected async sendCheckpoint(widget: EditorWidget): Promise<void> {
        const editor = MonacoEditor.get(widget)?.getControl();
        if (!editor) {
            return;
        }
        const model = editor.getModel();
        if (!model) {
            return;
        }
        const uri = new URI(model.uri.toString());
        const path = await this.workspace.getWorkspaceRelativePath(uri);
        this.journal.record({
            type: 'checkpoint',
            file: path,
            version: model.getVersionId() ?? -1,
            length: model.getValueLength() ?? 0,
            sha256: await this.sha256(model.getValue()),
        } satisfies ClientToServer.Checkpoint);
    }

    protected async sha256(text: string): Promise<string> {
        const data = new TextEncoder().encode(text);
        const digest = await crypto.subtle.digest('SHA-256', data);
        return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
    }
}
