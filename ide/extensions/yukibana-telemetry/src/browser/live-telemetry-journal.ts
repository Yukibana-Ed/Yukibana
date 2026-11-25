/**
 * SPDX-License-Identifier: MIT
 */
import { Emitter, ILogger } from '@theia/core';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { ApplicationServer } from '@theia/core/lib/common/application-protocol';
import { inject, injectable, named } from '@theia/core/shared/inversify';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { ConfigProvider } from '@yukibana/ide-ext/lib/browser/config/config-provider';
import { ServerToClientPayload } from '@yukibana/telemetry-protocol';
import { LiveTelemetryClient, LiveTelemetryService } from '../common/telemetry-protocol';
import { LiveTelemetryConsentDialog } from './live-telemetry-consent-dialog';

@injectable()
export class LiveTelemetryJournal implements FrontendApplicationContribution, LiveTelemetryClient {
    @inject(ConfigProvider) protected readonly configProvider!: ConfigProvider;
    @inject(LiveTelemetryService) protected readonly telemetry!: LiveTelemetryService;
    @inject(WorkspaceService) protected readonly workspace!: WorkspaceService;
    @inject(ApplicationServer) protected readonly appServer!: ApplicationServer;
    @inject(ILogger) @named('yukibana:LiveTelemetryReporter') protected readonly logger!: ILogger;

    protected readonly onCommandEmitter = new Emitter<ServerToClientPayload>();
    readonly onCommand$ = this.onCommandEmitter.event;

    onCommand(cmd: ServerToClientPayload): void {
        this.onCommandEmitter.fire(cmd);
    }

    async onStart(): Promise<void> {
        void this.configProvider.ready.then(async config => {
            if (!config.telemetry.liveTypingStats) {
                return;
            }
            const consent = (await new LiveTelemetryConsentDialog().open()) ?? false;
            if (consent) {
                void this.logger.info('Starting telemetry service');
                await this.telemetry.start({
                    projectId: config.projectId ?? '',
                    clientVersion: (await this.appServer.getApplicationInfo())?.version ?? 'unknown',
                });
            } else {
                await this.workspace.close();
            }
        });
    }
}
