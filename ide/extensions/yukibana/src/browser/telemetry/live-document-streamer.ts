/**
 * SPDX-License-Identifier: MIT
 */
import { Disposable, DisposableCollection, Emitter, nls } from '@theia/core';
import { FrontendApplication, FrontendApplicationContribution, StatusBar, StatusBarAlignment } from '@theia/core/lib/browser';
import { inject, injectable } from '@theia/core/shared/inversify';
import { EditorManager } from '@theia/editor/lib/browser';
import { editor } from '@theia/monaco-editor-core';
import { MonacoEditor } from '@theia/monaco/lib/browser/monaco-editor';
import { LiveTelemetry, LiveTelemetryService } from '../../common/yukibana-telemetry';
import { ConfigProvider } from '../config/config-provider';
import { LiveTelemetryClientImpl } from '../live-telemetry-client';

const throttle = <T extends unknown[]>(callback: (...args: T) => void, delay: number) => {
    let isWaiting = false;
    let lastArgs: T;

    return (...args: T) => {
        lastArgs = args;
        if (isWaiting) {
            return;
        }

        callback(...args);
        isWaiting = true;

        setTimeout(() => {
            callback(...lastArgs);
            isWaiting = false;
        }, delay);
    };
};

@injectable()
export class LiveDocumentStreamer implements FrontendApplicationContribution, Disposable {
    @inject(EditorManager) protected readonly editors!: EditorManager;
    @inject(LiveTelemetryService) protected readonly service!: LiveTelemetryService;
    @inject(LiveTelemetryClientImpl) protected readonly client!: LiveTelemetryClientImpl;
    @inject(ConfigProvider) protected readonly config!: ConfigProvider;
    @inject(StatusBar) protected readonly statusBar!: StatusBar;

    protected readonly onStreamingChangeEmitter = new Emitter<boolean>();
    readonly onStreamingChange = this.onStreamingChangeEmitter.event;

    protected streaming = false;
    protected readonly perDoc = new DisposableCollection();
    protected safetyTimer?: ReturnType<typeof setInterval>;

    async onStart(app: FrontendApplication): Promise<void> {
        this.client.onCommand$(cmd => {
            if (cmd.type === 'subscribe') {
                this.start();
            } else if (cmd.type === 'unsubscribe') {
                this.stop();
            } else if (cmd.type === 'sync' && this.streaming) {
                this.snapshot();
            }
        });
        this.editors.onCurrentEditorChanged(() => {
            if (this.streaming) {
                this.follow();
            }
        });
        this.onStreamingChange(streaming => this.setStatusBarElement(streaming));
        this.setStatusBarElement(this.streaming);
    }

    dispose(): void {
        this.stop();
    }

    protected async start(): Promise<void> {
        if (!(await this.config.ready).telemetry.liveTypingStats) {
            return;
        }
        this.streaming = true;
        this.follow();
        this.safetyTimer = setInterval(() => this.snapshot(), 30_000);
        this.onStreamingChangeEmitter.fire(this.streaming);
    }

    protected stop(): void {
        this.streaming = false;
        this.perDoc.dispose();
        clearInterval(this.safetyTimer);
        this.onStreamingChangeEmitter.fire(this.streaming);
    }

    protected getModel(): editor.ITextModel | undefined {
        const editor = MonacoEditor.get(this.editors.currentEditor)?.getControl();
        const model = editor?.getModel();
        if (!editor || !model) {
            return undefined;
        }
        return model;
    }

    protected follow(): void {
        this.perDoc.dispose();
        const editor = MonacoEditor.get(this.editors.currentEditor)?.getControl();
        const model = this.getModel();
        if (!editor || !model) {
            return;
        }
        const uri = model.uri;
        this.snapshot();
        this.perDoc.push(
            model.onDidChangeContent(e => {
                this.service.report({
                    type: 'doc',
                    uri: uri.toString(),
                    version: e.versionId,
                    changes: e.changes,
                } satisfies LiveTelemetry.DocSync);
            }),
        );
        this.perDoc.push(
            editor.onDidChangeCursorPosition(
                throttle(e => {
                    this.service.report({
                        type: 'doc',
                        uri: uri.toString(),
                        version: model.getVersionId(),
                        cursor: [e.position.lineNumber, e.position.column],
                    } satisfies LiveTelemetry.DocSync);
                }, 250),
            ),
        );
    }

    protected snapshot(): void {
        const model = this.getModel();
        if (!model) {
            return;
        }
        this.service.report({
            type: 'doc',
            uri: model.uri.toString(),
            version: model.getVersionId(),
            full: model.getValue(),
        });
    }

    protected setStatusBarElement(streaming: boolean): void {
        const label = nls.localize('yukibana/liveTelemetry/streaming', 'Teacher viewing');
        this.statusBar.setElement('remote-view-status', {
            text: streaming ? `$(codicon-eye) ${label}` : '$(codicon-eye-closed)',
            alignment: StatusBarAlignment.RIGHT,
            priority: 300,
            tooltip: this.getStatusBarTooltip(streaming),
            backgroundColor: streaming ? 'var(--theia-statusBarItem-prominentBackground)' : undefined,
            color: streaming ? 'var(--theia-statusBarItem-prominentForeground)' : undefined,
        });
    }

    protected getStatusBarTooltip(streaming: boolean): string {
        if (streaming) {
            return nls.localize('yukibana/liveTelemetry/streamingTooltip', 'Your teacher can see the files you are editing');
        }
        return nls.localize('yukibana/liveTelemetry/noStreamingTooltip', 'Remote view disabled');
    }
}
