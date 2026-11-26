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

    protected seq: number = 1;
    protected store: Envelope<ClientToServerPayload>[] = [];

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

        const priority = this.computePriority(payload);
        this.onEntryEmitter.fire({
            event: event,
            priority: priority,
        });
    }

    getBatch(): Envelope<ClientToServerPayload>[] {
        return this.store;
    }

    acknowledge(seq: number): void {
        this.store = this.store.filter(e => e.seq > seq);
    }

    protected computePriority(payload: ClientToServerPayload): LiveEventPriority {
        if (payload.type === 'hello') {
            return LiveEventPriority.IMPORTANT;
        }
        return LiveEventPriority.NORMAL;
    }
}
