/**
 * SPDX-License-Identifier: MIT
 */
import { DisposableCollection, URI } from '@theia/core';
import { inject, injectable } from '@theia/core/shared/inversify';
import { EditorManager, EditorWidget } from '@theia/editor/lib/browser';
import { editor } from '@theia/monaco-editor-core';
import { MonacoEditor } from '@theia/monaco/lib/browser/monaco-editor';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { ClientToServer } from '@yukibana/telemetry-protocol';
import { LiveTelemetrySourceContribution } from '../../common/telemetry-protocol';
import { throttle } from '../../common/utils';
import { LiveTelemetryJournal } from '../live-telemetry-journal';

const THROTTLE_MS = 200;

@injectable()
export class SelectionSource implements LiveTelemetrySourceContribution {
    @inject(LiveTelemetryJournal) protected readonly journal!: LiveTelemetryJournal;
    @inject(EditorManager) protected readonly editors!: EditorManager;
    @inject(WorkspaceService) protected readonly workspace!: WorkspaceService;

    protected readonly toDispose = new DisposableCollection();

    start(): void {
        this.editors.all.map(w => this.attach(w));
        this.editors.onCreated(w => this.attach(w));
    }
    dispose(): void {
        this.toDispose.dispose();
    }

    protected attach(widget: EditorWidget): void {
        const editor = MonacoEditor.get(widget)?.getControl();
        if (!editor) {
            return;
        }
        this.toDispose.push(
            editor.onDidChangeCursorSelection(
                throttle(async (e: editor.ICursorSelectionChangedEvent) => {
                    const uri = editor.getModel()?.uri;
                    const path = await this.workspace.getWorkspaceRelativePath(new URI(uri?.toString()));
                    this.journal.record({
                        type: 'selection',
                        file: path,
                        selections: [e.selection, ...e.secondarySelections].map(sel => [
                            [sel.startLineNumber, sel.startColumn],
                            [sel.endLineNumber, sel.endColumn],
                        ]),
                    } satisfies ClientToServer.Selection);
                }, THROTTLE_MS),
            ),
        );
    }
}
