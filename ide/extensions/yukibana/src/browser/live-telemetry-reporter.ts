import { ILogger } from '@theia/core';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { inject, injectable, named } from '@theia/core/shared/inversify';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { LiveTelemetryService } from '../common/yukibana-telemetry';
import { ConfigProvider } from './config/config-provider';
import { LiveTelemetryConsentDialog } from './telemetry/live-telemetry-consent-dialog';

@injectable()
export class LiveTelemetryReporter implements FrontendApplicationContribution {
    @inject(ConfigProvider) protected readonly configProvider!: ConfigProvider;
    @inject(LiveTelemetryService) protected readonly telemetry!: LiveTelemetryService;
    @inject(WorkspaceService) protected readonly workspace!: WorkspaceService;
    @inject(ILogger) @named('yukibana:LiveTelemetryReporter') protected readonly logger!: ILogger;

    async onStart(): Promise<void> {
        this.configProvider.ready.then(async config => {
            if (!config.telemetry.liveTypingStats) {
                return;
            }
            const consent = (await new LiveTelemetryConsentDialog().open()) ?? false;
            if (consent) {
                this.logger.info('Starting telemetry service');
                await this.telemetry.start({
                    projectId: config.projectId ?? '',
                });
            } else {
                this.workspace.close();
            }
        });
    }
}
