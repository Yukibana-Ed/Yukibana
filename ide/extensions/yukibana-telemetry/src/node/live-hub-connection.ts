/**
 * SPDX-License-Identifier: MIT
 */
import { Emitter, ILogger } from '@theia/core';
import { inject, injectable, named } from '@theia/core/shared/inversify';
import { Batch, ClientToServerPayload, Envelope, ServerToClientPayload } from '@yukibana/telemetry-protocol';
import { WebSocket } from 'ws';
import { LiveJournalStore } from './live-journal-store';
import { LiveSessionIdentity } from './live-session-identity';

const WS_URL = 'ws://localhost:5432/ws/student';

@injectable()
export class LiveHubConnection {
    @inject(LiveJournalStore) protected readonly store!: LiveJournalStore;
    @inject(LiveSessionIdentity) protected readonly session!: LiveSessionIdentity;
    @inject(ILogger) @named('yukibana:LiveHubConnection') protected readonly logger!: ILogger;

        protected ws?: WebSocket;
    
    protected readonly onCommandEmitter = new Emitter<ServerToClientPayload>();
    readonly onCommand = this.onCommandEmitter.event;

    start(): void {
        void this.logger.info('Starting');
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
            await this.sendHello();
        });
        this.ws.on('message', e => {
            // eslint-disable-next-line @typescript/no-base-to-string
            const messageString = e.toString();
            void this.logger.info(`WS message: ${messageString}`);
            const batch = JSON.parse(messageString) as Batch<ServerToClientPayload>;
for (const msg of batch.events) {
            this.onCommandEmitter.fire(msg.payload);
}
        });
        this.onCommand(cmd => {
            if (cmd.type === 'ack') {
                this.store.acknowledge(cmd.seq);
            }
        });
    }
    protected close(): void {
        void this.logger.info('Closing websocket');
        this.ws?.close();
    }

    protected async sendHello(): Promise<void> {
        this.send({
v: 2,
            seq: 0,
            ts: Date.now(),
            payload: {
            type: 'hello',
            studentId: this.session.studentId ?? '',
            projectId: this.session.projectId ?? '',
            clientVersion: (await this.session.clientVersion) ?? '',
},
        });
    }

    send(payload: Envelope<ClientToServerPayload>): Promise<boolean> {
        return this.sendBatch({ events: [payload] });
    }

    async sendBatch(batch: Batch<ClientToServerPayload>): Promise<boolean> {
        return new Promise(resolve => {
            if (!this.ws) {
                this.logger.warn('WebSocket not initialized');
                return resolve(false);
            }
            try {
                this.ws.send(JSON.stringify(batch), err => resolve(!err));
            } catch {
                this.logger.error('Error');
                resolve(false);
            }
        });
    }
}
