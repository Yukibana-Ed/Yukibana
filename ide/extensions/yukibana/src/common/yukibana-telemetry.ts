/**
 * SPDX-License-Identifier: MIT
 */
import { MaybePromise, RpcServer } from '@theia/core';

export namespace TypingTelemetry {
    export const EditPath = 'yukibana/edit';
    export type EditOrigin = 'type' | 'cut' | 'paste' | 'completion' | 'drag-drop' | 'delete' | 'command' | 'unknown';

    export interface EditChange {
        inserted: number;
        removed: number;
        origin: EditOrigin;
        command?: string;
        name?: string;
    }

    export interface Edit {
        sinceLastTyped: number;
        changes: EditChange[];
        file: string | undefined;
    }

    export interface EditData {
        sinceLastTyped: number;
        file: string;
        changeInserted: number[];
        changeRemoved: number[];
        changeOrigins: EditOrigin[];
        changeCommands: string[];
    }
}

export namespace LiveTelemetry {
    export interface Envelope<P extends Payload> {
        v: 2;
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

    // #region Client -> Server

    // #region Session lifecycle
    export interface Hello extends Payload {
        type: 'hello';
        studentId: string;
        projectId: string;
        sessionId?: string;
        clientVersion: string;
        configHash?: string;
        windowTitle?: string;
    }
    export interface State extends Payload {
        type: 'state';
        focused: boolean;
        activeFile?: FilePath;
        openFiles: FilePath[];
    }
    // #endregion

    // #region Journal
    export interface Snapshot extends Payload {
        type: 'snapshot';
        file: FilePath;
        version: number;
        text: string;
        eol: '\n' | '\r\n';
        sha256: string;
        reason: 'open' | 'external' | 'resync';
    }
    export interface Change {
        offset: number;
        length: number;
        text: string;
    }
    export interface Edit extends Payload {
        type: 'edit';
        file: FilePath;
        version: number;
        baseVersion: number;
        changes: Change[];
        origin: EditOrigin;
        invocation?: number;
        external?: boolean;
    }
    export interface Selection extends Payload {
        type: 'selection';
        file: FilePath;
        selections: [anchor: number, active: number][];
    }
    export interface Checkpoint extends Payload {
        type: 'checkpoint';
        file: FilePath;
        version: number;
        length: number;
        sha256: number;
    }
    // #endregion

    // #region Events
    export interface Command extends Payload {
        type: 'command';
        invocation: number;
        phase: 'start' | 'end';
        id: string;
        source?: 'keybinding' | 'menu' | 'palette' | 'toolbar' | 'code-action' | 'other';
        args?: unknown;
        ok?: boolean;
    }
    export interface Copy extends Payload {
        type: 'copy';
        file: FilePath;
        size: number;
        cut: boolean;
    }
    export interface AIPrompt extends Payload {
        type: 'ai-prompt';
        feature: string;
        chars: number;
        text?: string;
    }
    export interface FileOp extends Payload {
        type: 'file-op';
        op: 'create' | 'rename' | 'delete' | 'change';
        path: FilePath;
        newPath?: FilePath;
        by: 'ide' | 'disk';
    }
    export interface Terminal extends Payload {
        type: 'terminal';
        commandLine: string;
        exitCode?: number;
    }
    export interface Run extends Payload {
        type: 'run';
        target?: FilePath;
        exitCode?: number;
        durationMs?: number;
    }
    export interface Test extends Payload {
        type: 'test';
        results: {
            name: string;
            status: 'passed' | 'failed' | 'error' | 'skipped';
        }[];
        durationMs?: number;
    }
    export interface Problems extends Payload {
        type: 'problems';
        byFile: Record<FilePath, { errors: number; warning: number }>;
        errors: number;
        warnings: number;
    }
    export interface Submit extends Payload {
        type: 'submit';
        ref?: string;
    }
    // #endregion
    // #endregion

    // #region Server -> Client
    export interface Welcome extends Payload {
        type: 'welcome';
        sessionId: string;
        resumed: boolean;
        ackedSeq: number;
        serverTime: number;
        heartbeatMs: number;
        maxDocChars: number;
    }
    export interface Resync extends Payload {
        type: 'sync';
        path: FilePath;
    }
    // #endregion

    export type ClientToServerPayload = Hello | State | Snapshot | Edit | Selection | Checkpoint | Command | Copy | AIPrompt | FileOp | Terminal | Run | Test | Problems | Submit;
    export type ServerToClientPayload = Welcome | Resync;
}

export interface LiveSessionContext {
    studentId: string;
    projectId: string;
    clientVersion: string;
}

export const LiveTelemetrySink = Symbol('LiveTelemetrySink');
export interface LiveTelemetrySink {
    send(payload: LiveTelemetry.ClientToServerPayload): void;
    dispose(): void;
}

export const LiveTelemetryServicePath = 'yukibana/live-telemetry';
export const LiveTelemetryService = Symbol('LiveTelemetryService');
export interface LiveTelemetryService extends RpcServer<LiveTelemetryClient> {
    start(ctx: Omit<LiveSessionContext, 'studentId'>): MaybePromise<void>;
    report(event: LiveTelemetry.ClientToServerPayload): void;
    stop(): void;
}

export interface LiveTelemetryClient {
    onCommand(command: LiveTelemetry.ServerToClientPayload): void;
}

export interface LiveTelemetrySinkHost {
    dispatch(command: LiveTelemetry.ServerToClientPayload): void;
}
