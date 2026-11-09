/**
 * SPDX-License-Identifier: MIT
 */
import { inject, injectable } from '@theia/core/shared/inversify';
import { TelemetryEvent } from '@theia/telemetry/lib/common/telemetry-protocol';
import { TelemetrySink } from '@theia/telemetry/lib/node';
import { IdentityService } from '@yukibana/ide-ext/lib/node/identity-service';

const BATCH_SIZE = 50;
const MAX_DRAIN_DELAY_MS = 10_000;
const ENDPOINT = 'http://localhost:5432/telemetry';

/**
 * Sends Yukibana's telemetry events, in batches, to the telemetry endpoint `http://localhost:5432/telemetry`, as JSON
 * `{ identity: { provider, id }, events }`, the identity being {@link IdentityService}'s at the time of sending.
 *
 * A batch goes when 50 events are waiting, or 10 seconds after the first of them. A batch that fails (the endpoint
 * cannot be reached, takes over 5 seconds, answers an error status, or no identity can be had) goes back to the front
 * of the queue and is tried again only once another event arrives: events are kept, in memory and without bound, until
 * a batch goes, and lost when the backend stops, since there is no `flush`.
 */
@injectable()
export class YukibanaTelemetrySink implements TelemetrySink {
    /** The sink's id among Theia's telemetry sinks. */
    readonly id = 'yukibana/usage';
    /** The topics the sink receives: every topic under `yukibana/`, at any depth. */
    readonly interests: readonly string[] = ['yukibana/*'];
    /** `'remote'`: the events leave this machine, so Theia passes on only the kinds the user's telemetry level allows. */
    readonly scope = 'remote';

    private queue: TelemetryEvent[] = [];
    private timer?: NodeJS.Timeout;

    /** Whose events these are. */
    @inject(IdentityService) protected readonly identityService!: IdentityService;

    /** Queues `event`, and starts sending the queue when it is full; returns at once and never throws. */
    handle(event: TelemetryEvent): void {
        this.queue.push(event);
        if (this.queue.length >= BATCH_SIZE) {
            this.drain();
        } else {
            this.timer ??= setTimeout(() => this.drain(), MAX_DRAIN_DELAY_MS);
        }
    }

    private async drain(): Promise<void> {
        clearTimeout(this.timer);
        this.timer = undefined;
        const batch = this.queue.splice(0);
        if (!batch.length) {
            return;
        }
        try {
            await this.sendBatch(batch);
        } catch {
            this.queue.unshift(...batch);
        }
    }

    private async sendBatch(batch: TelemetryEvent[]): Promise<void> {
        const identity = await this.identityService.getIdentity();
        const res = await fetch(ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                identity: {
                    provider: this.identityService.ID,
                    id: identity,
                },
                events: batch,
            }),
            signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) {
            throw new Error(`${res.status} ${res.statusText}`);
        }
    }
}
