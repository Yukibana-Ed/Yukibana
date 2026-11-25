export const PROTOCOL_VERSION = 2;

export interface Envelope<P extends Payload> {
    v: typeof PROTOCOL_VERSION;
    seq: number;
    ts: number;
    payload: P;
}
export interface Batch<P extends Payload> {
    events: Envelope<P>[];
}

export interface Payload {
    type: string;
}
export type FilePath = string;
export type EditOrigin = 'type' | 'cut' | 'paste' | 'completion' | 'ai-completion' | 'drag-drop' | 'delete' | 'command' | 'unknown';
