/**
 * SPDX-License-Identifier: MIT
 */
import { Emitter } from '@theia/core';
import { inject, injectable } from '@theia/core/shared/inversify';
import { ClientToServerPayload, Envelope } from '@yukibana/telemetry-protocol';
import { LiveEventPriority } from '../common/telemetry-protocol';
import { LiveSessionIdentity } from './live-session-identity';

@injectable()
export class LiveJournalStore {
    @inject(LiveSessionIdentity) protected readonly session!: LiveSessionIdentity;

    protected seq: number = 0;
    protected store: Envelope<any>[] = [];

    protected readonly onEntryEmitter = new Emitter<{ event: Envelope<ClientToServerPayload>; priority: LiveEventPriority }>();
    readonly onEntry = this.onEntryEmitter.event;

    append(payload: ClientToServerPayload): void {
        const event = {
            v: 2,
            seq: this.seq++,
            ts: Date.now(),
            payload: payload,
        } satisfies Envelope<ClientToServerPayload>;
        // TODO: persist to disk
        this.store.push(event);

        // TODO: choose priority based on event type
        this.onEntryEmitter.fire({
            event: event,
            priority: LiveEventPriority.NORMAL,
        });
    }

    getBatch(): Envelope<any>[] {
        return this.store;
    }
}
