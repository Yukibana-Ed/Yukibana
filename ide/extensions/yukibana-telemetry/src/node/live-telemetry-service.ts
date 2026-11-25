/**
 * SPDX-License-Identifier: MIT
 */
import { Disposable, ILogger } from '@theia/core';
import { inject, injectable, named } from '@theia/core/shared/inversify';
import { ClientToServerPayload, ServerToClientPayload } from '@yukibana/telemetry-protocol';
import { LiveSessionContext, LiveTelemetryClient, LiveTelemetryService } from '../common/telemetry-protocol';
import { LiveFlushScheduler } from './live-flush-scheduler';
import { LiveJournalStore } from './live-journal-store';
import { LiveSessionIdentity } from './live-session-identity';

@injectable()
export class LiveTelemetryServiceImpl implements LiveTelemetryService, Disposable {
    @inject(LiveSessionIdentity) protected readonly session!: LiveSessionIdentity;
    @inject(LiveJournalStore) protected readonly store!: LiveJournalStore;
    @inject(LiveFlushScheduler) protected readonly scheduler!: LiveFlushScheduler;
    @inject(ILogger) @named('yukibana:LiveTelemetryService') protected readonly logger!: ILogger;

    protected client: LiveTelemetryClient | undefined;

    async start(ctx: Omit<LiveSessionContext, 'studentId'>): Promise<void> {}

    report(event: ClientToServerPayload): void {}

    dispose(): void {
        this.stop();
    }

    stop(): void {}

    setClient(client: LiveTelemetryClient | undefined): void {
        this.client = client;
    }

    getClient(): LiveTelemetryClient | undefined {
        return this.client;
    }

    dispatch(command: ServerToClientPayload): void {
        this.client?.onCommand(command);
    }
}
