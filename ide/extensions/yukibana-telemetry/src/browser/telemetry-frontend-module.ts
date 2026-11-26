/**
 * SPDX-License-Identifier: MIT
 */
import '../../src/browser/style/index.css';

import { FrontendApplicationContribution, ServiceConnectionProvider } from '@theia/core/lib/browser';
import { ContainerModule } from '@theia/core/shared/inversify';
import { LiveTelemetryService, LiveTelemetryServicePath } from '../common/telemetry-protocol';
import { EditOriginResolver } from './edit-origin-resolver';
import { LiveTelemetryClientImpl } from './live-telemetry-client';
import { LiveTelemetryContribution } from './live-telemetry-contribution';
import { LiveTelemetryJournal } from './live-telemetry-journal';
import { LiveTelemetryPolicy } from './live-telemetry-policy';
import { bindLiveSourceContributions } from './sources/live-source-contributions';

export default new ContainerModule(bind => {
    bind(EditOriginResolver).toSelf().inSingletonScope();
    bind(LiveTelemetryPolicy).toSelf().inSingletonScope();
    bind(LiveTelemetryJournal).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(LiveTelemetryJournal);
    bind(LiveTelemetryClientImpl).toSelf().inSingletonScope();
    bind(LiveTelemetryService)
        .toDynamicValue(ctx => ServiceConnectionProvider.createProxy<LiveTelemetryService>(ctx.container, LiveTelemetryServicePath, ctx.container.get(LiveTelemetryClientImpl)))
        .inSingletonScope();

    bindLiveSourceContributions(bind);
    bind(LiveTelemetryContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(LiveTelemetryContribution);
});
