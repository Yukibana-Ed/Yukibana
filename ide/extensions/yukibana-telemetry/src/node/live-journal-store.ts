/**
 * SPDX-License-Identifier: MIT
 */
import { inject, injectable } from '@theia/core/shared/inversify';
import { LiveSessionIdentity } from './live-session-identity';

@injectable()
export class LiveJournalStore {
    @inject(LiveSessionIdentity) protected readonly session!: LiveSessionIdentity;
}
