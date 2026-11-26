/**
 * SPDX-License-Identifier: MIT
 */
import { ConnectionContainerModule } from '@theia/core/lib/node/messaging/connection-container-module';
import { ContainerModule } from '@theia/core/shared/inversify';
import { TelemetrySink } from '@theia/telemetry/lib/node';
import { LiveTelemetryClient, LiveTelemetryService, LiveTelemetryServicePath } from '../common/telemetry-protocol';
import { LiveFlushScheduler } from './live-flush-scheduler';
import { LiveHubConnection } from './live-hub-connection';
import { LiveJournalStore } from './live-journal-store';
import { LiveSessionIdentity } from './live-session-identity';
import { LiveTelemetryServiceImpl } from './live-telemetry-service';
import { YukibanaTelemetrySink } from './yukibana-telemetry-sink';

export const liveTelemetryConnectionContainerModule = ConnectionContainerModule.create(({ bind, bindBackendService }) => {
    bind(LiveSessionIdentity).toSelf().inSingletonScope();
    bind(LiveJournalStore).toSelf().inSingletonScope();
    bind(LiveHubConnection).toSelf().inSingletonScope();
    bind(LiveFlushScheduler).toSelf().inSingletonScope();
    bind(LiveTelemetryServiceImpl).toSelf().inSingletonScope();
    bind(LiveTelemetryService).toService(LiveTelemetryServiceImpl);
    bindBackendService<LiveTelemetryService, LiveTelemetryClient>(LiveTelemetryServicePath, LiveTelemetryService, (service, client) => {
        service.setClient(client);
        client.onDidCloseConnection(() => service.dispose());
        return service;
    });
});

/** The telemetry extension's backend: {@link YukibanaTelemetrySink} as a singleton telemetry sink. */
export default new ContainerModule(bind => {
    bind(YukibanaTelemetrySink).toSelf().inSingletonScope();
    bind(TelemetrySink).toService(YukibanaTelemetrySink);

    bind(ConnectionContainerModule).toConstantValue(liveTelemetryConnectionContainerModule);
});
