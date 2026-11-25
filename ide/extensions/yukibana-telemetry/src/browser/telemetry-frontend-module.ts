/**
 * SPDX-License-Identifier: MIT
 */
import '../../src/browser/style/index.css';

import { FrontendApplicationContribution, ServiceConnectionProvider } from '@theia/core/lib/browser';
import { ContainerModule } from '@theia/core/shared/inversify';
import { LiveTelemetryService, LiveTelemetryServicePath } from '../common/telemetry-protocol';
import { LiveTelemetryClientImpl } from './live-telemetry-client';
import { LiveTelemetryJournal } from './live-telemetry-journal';
import { LiveTelemetryPolicy } from './live-telemetry-policy';

export default new ContainerModule(bind => {
    bind(LiveTelemetryPolicy).toSelf().inSingletonScope();
    bind(LiveTelemetryJournal).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(LiveTelemetryJournal);
    bind(LiveTelemetryClientImpl).toSelf().inSingletonScope();
    bind(LiveTelemetryService)
        .toDynamicValue(ctx => ServiceConnectionProvider.createProxy<LiveTelemetryService>(ctx.container, LiveTelemetryServicePath, ctx.container.get(LiveTelemetryClientImpl)))
        .inSingletonScope();
});
