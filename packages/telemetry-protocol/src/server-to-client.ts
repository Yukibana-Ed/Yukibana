import type { FilePath, Payload } from './common.js';

export namespace ServerToClient {
    /** First message sent by the server at the start of a session */
    export interface Welcome extends Payload {
        type: 'welcome';
        sessionId: string;
        resumed: boolean;
        ackedSeq: number;
        serverTime: number;
        heartbeatMs: number;
        maxDocChars: number;
    }

    /** Flush cadence parameters */
    export interface Cadence extends Payload {
        type: 'cadence';
        flushMs: number;
        flushNow?: boolean;
    }

    /** Acknowledge journal entries */
    export interface Ack extends Payload {
        type: 'ack';
        seq: number;
    }

    /** Document synchronization request */
    export interface Resync extends Payload {
        type: 'resync';
        file: FilePath;
    }
}

export type ServerToClientPayload = ServerToClient.Welcome | ServerToClient.Cadence | ServerToClient.Ack | ServerToClient.Resync;
