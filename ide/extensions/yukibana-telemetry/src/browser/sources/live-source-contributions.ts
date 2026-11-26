import { bindContributionProvider } from '@theia/core';
import { interfaces } from '@theia/core/shared/inversify';
import { LiveTelemetrySourceContribution } from '../../common/telemetry-protocol';
import { ProblemsSource } from './problems-source';

export function bindLiveSourceContributions(bind: interfaces.Bind): void {
    bindContributionProvider(bind, LiveTelemetrySourceContribution);

    bind(ProblemsSource).toSelf().inSingletonScope();
    bind(LiveTelemetrySourceContribution).toService(ProblemsSource);
}
