/**
 * SPDX-License-Identifier: MIT
 */
import { Disposable, DisposableCollection, ILogger } from '@theia/core';
import { inject, injectable, named } from '@theia/core/shared/inversify';
import { LiveEventPriority } from '../common/telemetry-protocol.js';
import { LiveHubConnection } from './live-hub-connection.js';
import { LiveJournalStore } from './live-journal-store';

const DEFAULT_FLUSH_INTERVAL_MS = 2000;

@injectable()
export class LiveFlushScheduler implements Disposable {
    @inject(LiveJournalStore) protected readonly store!: LiveJournalStore;
    @inject(LiveHubConnection) protected readonly hub!: LiveHubConnection;
    @inject(ILogger) @named('yukibana:LiveFlushScheduler') protected readonly logger!: ILogger;

    protected readonly toDispose = new DisposableCollection();
    protected interval?: ReturnType<typeof setInterval>;

    start(): void {
        this.logger.info('Initializing');
        this.toDispose.push(
            this.hub.onCommand(cmd => {
                if (cmd.type === 'cadence') {
                    this.setFlushRate(cmd.flushMs);
                    if (cmd.flushNow) {
                        this.flush();
                    }
                }
            }),
        );

        this.interval = setInterval(() => this.flush(), DEFAULT_FLUSH_INTERVAL_MS);
        this.toDispose.push({
            dispose: () => {
                if (this.interval !== undefined) {
                    clearInterval(this.interval);
                    this.interval = undefined;
                }
            },
        });
        this.toDispose.push(this.store.onEntry(e => this.notify(e.priority)));
    }

    dispose(): void {
        this.toDispose.dispose();
    }

    protected setFlushRate(rateMs: number): void {
        this.logger.info(`Set flush rate to ${rateMs}`);
        if (this.interval !== undefined) {
            clearInterval(this.interval);
        }
        this.interval = setInterval(() => this.flush(), rateMs);
    }

    protected flush(): void {
        const batch = this.store.getBatch();
        if (batch.length === 0) {
            return;
        }
        this.logger.info(`Flush ${batch.length} events`);
        this.hub.sendBatch({ events: batch });
    }

    notify(priority: LiveEventPriority): void {
        if (priority === LiveEventPriority.IMPORTANT) {
            this.flush();
        }
        // TODO: flush if batch too big
    }
}
