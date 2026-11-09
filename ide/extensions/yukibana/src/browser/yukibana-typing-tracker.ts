/**
 * SPDX-License-Identifier: MIT
 */
import { ILogger } from '@theia/core';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { inject, injectable, named } from '@theia/core/shared/inversify';
import { EditorManager, EditorWidget } from '@theia/editor/lib/browser';
import { editor } from '@theia/monaco-editor-core';
import { MonacoEditor } from '@theia/monaco/lib/browser/monaco-editor';
import { TelemetryService } from '@theia/telemetry/lib/common/telemetry-service';
import { TypingTelemetry } from '../common/yukibana-telemetry';
import { ConfigProvider } from './config/config-provider';

interface EditReason {
    metadata?: {
        source?: string;
        kind?: string;
        name?: string;
        detailedSource?: string;
    };
}

/**
 * Reports each change a student makes in an editor as telemetry ({@link TypingTelemetry.EditPath}), iff the first config
 * applied has `telemetry.liveTypingStats` on. Once on it stays on for the window: a later config change neither starts
 * nor stops it.
 *
 * Undo and redo are not reported. It sends sizes, kinds, the command that made a change (Monaco's `detailedSource`) and
 * the file's URI, which names the student's home directory; never the text.
 */
@injectable()
export class YukibanaTypingTracker implements FrontendApplicationContribution {
    /** The editors whose changes are reported. */
    @inject(EditorManager) protected readonly editors!: EditorManager;
    /** Where the reports go. */
    @inject(TelemetryService) protected readonly telemetry!: TelemetryService;
    /** The config whose `telemetry.liveTypingStats` turns reporting on. */
    @inject(ConfigProvider) protected readonly config!: ConfigProvider;
    /** The tracker's logger; nothing logs to it yet. */
    @inject(ILogger) @named('yukibana:TypingTracker') protected readonly logger!: ILogger;

    /** Waits for the first config and, if it asks for typing stats, follows every editor open now and opened later. */
    async onStart(): Promise<void> {
        const config = await this.config.ready;
        if (config.telemetry.liveTypingStats) {
            this.editors.all.forEach(w => this.attach(w));
            this.editors.onCreated(w => this.attach(w));
        }
    }

    /**
     * Reports every content change of the Monaco editor in `widget`, or does nothing if it has none.
     *
     * Reads `detailedReasons` and `detailedReasonsChangeLengths`. Only `detailedReasons` is missing from the public
     * `IModelContentChangedEvent` (Monaco declares it internally, in `textModelEvents`), hence the cast adding it; an
     * editor whose event lacks it throws on each change.
     */
    protected attach(widget: EditorWidget): void {
        const monaco = MonacoEditor.get(widget)?.getControl();
        if (!monaco) {
            return;
        }

        let lastTyped = 0;
        monaco.onDidChangeModelContent(rawEvent => {
            const e = rawEvent as editor.IModelContentChangedEvent & { detailedReasons: EditReason[] };
            const now = performance.now();
            const sinceLastTyped = now - lastTyped;
            lastTyped = now;
            if (e.isUndoing || e.isRedoing) {
                return;
            }
            const changes: TypingTelemetry.EditChange[] = [];
            let changeIdx: number = 0;
            for (let i = 0; i < e.detailedReasons.length; i++) {
                const detailedReason = e.detailedReasons[i];
                const origin = this.originOfChange(detailedReason);
                const nChanges = e.detailedReasonsChangeLengths[i];
                const command = origin === 'command' || origin === 'unknown' ? detailedReason.metadata?.detailedSource : undefined;
                for (let j = 0; j < nChanges; j++) {
                    const change = e.changes[changeIdx++];
                    changes.push({
                        inserted: change.text.length,
                        removed: change.rangeLength,
                        origin: origin,
                        command: command,
                    });
                }
            }
            const edit: TypingTelemetry.Edit = {
                sinceLastTyped: sinceLastTyped,
                changes: changes,
                file: monaco.getModel()?.uri?.toString(),
            };
            this.report(edit);
        });
    }

    /** Returns what made a change, from the reason Monaco gives for it; `unknown` when it says nothing we recognise. */
    // Adapted from https://github.com/hexlet-codebattle/codebattle/blob/f030dcca05eb81c87a2bfbc78ec174907969504c/frontend/src/features/game/editor/telemetry.ts
    protected originOfChange(detailedReason: EditReason): TypingTelemetry.EditOrigin {
        const { source, kind, detailedSource } = detailedReason.metadata ?? {};
        if (source === 'suggest' || source === 'snippet') {
            return 'completion';
        }
        if (source === 'cursor') {
            if (kind === 'type' || kind === 'compositionType' || kind === 'compositionEnd') {
                return 'type';
            }
            if (kind === 'executeCommand' || kind === 'executeCommands') {
                if (detailedSource === 'deleteLeft' || detailedSource === 'deleteWordLeft' || detailedSource === 'deleteRight' || detailedSource === 'deleteWordRight') {
                    return 'delete';
                }
                if (detailedSource === 'editor.contrib.dragAndDrop') {
                    return 'drag-drop';
                }
                return 'command';
            }
            if (kind === 'cut') {
                return 'cut';
            }
            if (kind === 'paste') {
                return 'paste';
            }
        }
        return 'unknown';
    }

    /**
     * Sends `event` as columns: `sinceLastTyped` in milliseconds since the editor's previous change (undo and redo
     * included), or since the page loaded for the first; inserted and removed lengths in UTF-16 code units; a missing
     * file or command as `''`.
     */
    protected report(event: TypingTelemetry.Edit): void {
        const data = {
            sinceLastTyped: event.sinceLastTyped,
            file: event.file ?? '',
            changeInserted: event.changes.map(c => c.inserted),
            changeRemoved: event.changes.map(c => c.removed),
            changeOrigins: event.changes.map(c => c.origin),
            changeCommands: event.changes.map(c => c.command ?? ''),
        } satisfies TypingTelemetry.EditData;
        this.telemetry.report(TypingTelemetry.EditPath, data);
    }
}
