/**
 * SPDX-License-Identifier: MIT
 */
import { Disposable, ILogger } from '@theia/core';
import { inject, injectable, named } from '@theia/core/shared/inversify';
import { ClientToServerPayload } from '@yukibana/telemetry-protocol';
import { LiveSessionContext, LiveTelemetryClient, LiveTelemetryService } from '../common/telemetry-protocol';
import { LiveFlushScheduler } from './live-flush-scheduler';
import { LiveHubConnection } from './live-hub-connection';
import { LiveJournalStore } from './live-journal-store';
import { LiveSessionIdentity } from './live-session-identity';

@injectable()
export class LiveTelemetryServiceImpl implements LiveTelemetryService, Disposable {
    @inject(LiveSessionIdentity) protected readonly session!: LiveSessionIdentity;
    @inject(LiveJournalStore) protected readonly store!: LiveJournalStore;
    @inject(LiveFlushScheduler) protected readonly scheduler!: LiveFlushScheduler;
    @inject(LiveHubConnection) protected readonly hub!: LiveHubConnection;
    @inject(ILogger) @named('yukibana:LiveTelemetryService') protected readonly logger!: ILogger;

    protected client: LiveTelemetryClient | undefined;

    start(ctx: Omit<LiveSessionContext, 'studentId'>): void {
        this.logger.info('Starting');
        this.session.setProjectId(ctx.projectId);
        this.session.setConfigHash(ctx.configHash);
        this.hub.onCommand(command => this.client?.onCommand(command));
        this.hub.start({ ...ctx, studentId: this.session.studentId ?? '' });
    }

    report(payload: ClientToServerPayload): void {
        this.store.append(payload);
    }

    dispose(): void {
        this.stop();
    }

    stop(): void {
        this.logger.info('Stopping');
    }

    setClient(client: LiveTelemetryClient | undefined): void {
        this.client = client;
    }

    getClient(): LiveTelemetryClient | undefined {
        return this.client;
    }
}
