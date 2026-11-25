/**
 * SPDX-License-Identifier: MIT
 */
import { inject, injectable } from '@theia/core/shared/inversify';
import { LiveHubConnection } from './live-hub-connection.js';
import { LiveJournalStore } from './live-journal-store';

@injectable()
export class LiveFlushScheduler {
    @inject(LiveJournalStore) protected readonly store!: LiveJournalStore;
    @inject(LiveHubConnection) protected readonly hub!: LiveHubConnection;
}
