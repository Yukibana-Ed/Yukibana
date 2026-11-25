/**
 * SPDX-License-Identifier: MIT
 */
import { Emitter, ILogger } from '@theia/core';
import { inject, injectable, named } from '@theia/core/shared/inversify';
import { Batch, ClientToServerPayload, Envelope, ServerToClientPayload } from '@yukibana/telemetry-protocol';
import { WebSocket } from 'ws';
import { LiveSessionContext } from '../common/telemetry-protocol';
import { LiveJournalStore } from './live-journal-store';

const BATCH_SIZE = 50;
const MAX_DRAIN_DELAY_MS = 1_000;
const WS_URL = 'ws://localhost:5432/ws/student';

@injectable()
export class LiveHubConnection {
    @inject(LiveJournalStore) protected readonly store!: LiveJournalStore;
    @inject(ILogger) @named('yukibana:LiveHubConnection') protected readonly logger!: ILogger;

    protected queue: Envelope<ClientToServerPayload>[] = [];
    protected timer?: NodeJS.Timeout;
    protected ws?: WebSocket;
    protected seq: number = 0;

    protected sessionCtx?: LiveSessionContext;

    protected readonly onCommandEmitter = new Emitter<ServerToClientPayload>();
    readonly onCommand = this.onCommandEmitter.event;

    protected start(sessionCtx: LiveSessionContext): void {
        void this.logger.info('Starting');
        this.sessionCtx = sessionCtx;
        return this.open();
    }

    dispose(): void {
        this.close();
    }

    protected open(): void {
        void this.logger.info(`Connecting to ${WS_URL}`);
        this.ws = new WebSocket(WS_URL);
        this.ws.on('error', e => {
            void this.logger.error(e);
        });
        this.ws.on('open', async () => {
            this.sendHello();
        });
        this.ws.on('message', e => {
            // eslint-disable-next-line @typescript/no-base-to-string
            const messageString = e.toString();
            void this.logger.info(`WS message: ${messageString}`);
            const msg = JSON.parse(messageString) as Envelope<ServerToClientPayload>;
            this.onCommandEmitter.fire(msg.payload);
            // this.host.dispatch(msg.payload);
        });
    }
    protected close(): void {
        void this.logger.info('Closing websocket');
        this.ws?.close();
    }

    protected sendHello(): void {
        this.send({
            type: 'hello',
            studentId: this.sessionCtx?.studentId ?? '',
            projectId: this.sessionCtx?.projectId ?? '',
            clientVersion: this.sessionCtx?.clientVersion ?? '',
        });
    }

    send(payload: ClientToServerPayload): void {
        void this.logger.info(`Sending payload of type ${payload.type}`);
        const message: Envelope<ClientToServerPayload> = {
            v: 2,
            seq: this.seq++,
            ts: Date.now(),
            payload: payload,
        };
        this.queue.push(message);
        if (this.mustSendImmediately(payload) || this.queue.length >= BATCH_SIZE) {
            void this.drain();
        } else {
            this.timer ??= setTimeout(() => this.drain(), MAX_DRAIN_DELAY_MS);
        }
    }

    protected mustSendImmediately(payload: ClientToServerPayload): boolean {
        // TODO: rewrite
        return false;
    }

    protected async drain(): Promise<void> {
        clearTimeout(this.timer);
        this.timer = undefined;
        if (!this.ws) {
            return;
        }
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

    protected async sendBatch(batch: Envelope<ClientToServerPayload>[]): Promise<void> {
        if (!this.ws) {
            return;
        }
        this.ws.send(
            JSON.stringify({
                events: batch,
            } satisfies Batch<ClientToServerPayload>),
        );
    }
}
