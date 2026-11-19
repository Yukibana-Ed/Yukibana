import { Disposable, DisposableCollection, ILogger } from '@theia/core';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { WindowFocusEvent, WindowFocusService } from '@theia/core/lib/browser/window/window-focus-service';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import { inject, injectable, named } from '@theia/core/shared/inversify';
import { EditorManager } from '@theia/editor/lib/browser';
import { LiveTelemetry, LiveTelemetryService, TypingTelemetry } from '../../common/yukibana-telemetry';
import { YukibanaTypingTracker } from '../yukibana-typing-tracker';

const FLUSH_INTERVAL_MS = 2000;

@injectable()
export class StatsAggregator implements FrontendApplicationContribution, Disposable {
    @inject(ILogger) @named('yukibana:StatsAggregator') protected readonly logger!: ILogger;
    @inject(YukibanaTypingTracker) protected readonly tracker!: YukibanaTypingTracker;
    @inject(LiveTelemetryService) protected readonly telemetry!: LiveTelemetryService;
    @inject(EditorManager) protected readonly editors!: EditorManager;
    @inject(WindowService) protected readonly window!: WindowService;
    @inject(WindowFocusService) protected readonly focus!: WindowFocusService;

    protected batch: TypingTelemetry.Edit[] = [];
    protected readonly toDispose = new DisposableCollection();
    protected isFocused: boolean = false;

    protected lastFocus: number | undefined;
    protected lastBlur: number | undefined;
    protected focusDuration: number = 0;
    protected blurDuration: number = 0;

    onStart() {
        this.logger.info('Starting');
        this.toDispose.push(this.tracker.onDidEdit(e => this.onDidEdit(e)));
        this.toDispose.push(this.focus.onDidWindowChangeFocus(e => this.onDidFocusChange(e)));
        const interval = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);
        this.toDispose.push({ dispose: () => clearInterval(interval) });
    }

    dispose(): void {
        this.toDispose.dispose();
    }

    protected onDidEdit(edit: TypingTelemetry.Edit): void {
        this.batch.push(edit);
    }

    protected onDidFocusChange(event: WindowFocusEvent): void {
        const now = Date.now();
        if (event.hasFocus) {
            if (this.lastBlur !== undefined) {
                this.blurDuration += now - this.lastBlur;
            }
            this.lastFocus = now;
        } else {
            if (this.lastFocus !== undefined) {
                this.focusDuration += now - this.lastFocus;
            }
            this.lastBlur = now;
        }
    }

    protected flush(): void {
        const activeFile = this.editors.activeEditor?.editor.document.uri;
        let inserted = 0;
        let removed = 0;
        const pastes: LiveTelemetry.PasteStats[] = [];
        const commands: string[] = [];
        for (const edit of this.batch) {
            for (const change of edit.changes) {
                inserted += change.inserted;
                removed += change.removed;
                if (change.origin === 'paste') {
                    pastes.push({
                        size: change.inserted,
                        external: false,
                    });
                } else if (change.origin === 'command' && change.command !== undefined) {
                    commands.push(change.command);
                }
            }
        }
        this.telemetry.report({
            type: 'stats',
            windowMs: this.focusDuration,
            idleMs: this.blurDuration,
            charsInserted: inserted,
            charsDeleted: removed,
            pastes: pastes,
            commands: commands,
            activeFile: activeFile,
            focused: this.focus.hasFocus,
        } satisfies LiveTelemetry.Stats);
        this.focusDuration = 0;
        this.blurDuration = 0;
        this.batch = [];
    }
}
