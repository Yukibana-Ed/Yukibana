/**
 * SPDX-License-Identifier: MIT
 */
import { ILogger, nls } from '@theia/core';
import { FrontendApplicationContribution, StatusBar, StatusBarAlignment } from '@theia/core/lib/browser';
import { ApplicationServer } from '@theia/core/lib/common/application-protocol';
import { inject, injectable, named } from '@theia/core/shared/inversify';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { ConfigProvider } from '@yukibana/ide-ext/lib/browser/config/config-provider';
import { LiveTelemetryService } from '../common/telemetry-protocol';
import { LiveTelemetryConsentDialog } from './live-telemetry-consent-dialog';

@injectable()
export class LiveTelemetryJournal implements FrontendApplicationContribution {
    @inject(ConfigProvider) protected readonly configProvider!: ConfigProvider;
    @inject(LiveTelemetryService) protected readonly telemetry!: LiveTelemetryService;
    @inject(WorkspaceService) protected readonly workspace!: WorkspaceService;
    @inject(ApplicationServer) protected readonly appServer!: ApplicationServer;
    @inject(StatusBar) protected readonly statusBar!: StatusBar;
    @inject(ILogger) @named('yukibana:LiveTelemetryJournal') protected readonly logger!: ILogger;

    async onStart(): Promise<void> {
        this.logger.info('Initializing');
        void this.configProvider.onConfigChanged(config => this.setStatusBarElement(config.telemetry.liveTypingStats));
        void this.configProvider.ready.then(async config => {
            if (!config.telemetry.liveTypingStats) {
                this.logger.info('Live telemetry is disabled');
                return;
            }
            const consent = (await new LiveTelemetryConsentDialog().open()) ?? false;
            if (consent) {
                void this.logger.info('Starting telemetry service');
                this.telemetry.start({
                    projectId: config.projectId ?? '',
                    clientVersion: (await this.appServer.getApplicationInfo())?.version ?? 'unknown',
                    configHash: await this.configProvider.getHash(),
                });
            } else {
                this.logger.info('Closing workspace');
                await this.workspace.close();
            }
        });
    }

    protected setStatusBarElement(enabled: boolean): void {
        if (enabled) {
            void this.statusBar.setElement('remote-view-status', {
                text: '$(codicon-record)',
                alignment: StatusBarAlignment.RIGHT,
                priority: 300,
                tooltip: nls.localize('yukibana/liveTelemetry/streamingTooltip', 'Your session is being recorded. Your teacher may see the files you are editing'),
                className: 'recording-indicator',
            });
        } else {
            void this.statusBar.removeElement('remote-view-status');
        }
    }
}
