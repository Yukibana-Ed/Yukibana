import type { EditOrigin, FilePath, Payload } from './common.js';

/**
 * Messages sent from the client (IDE) to the server
 */
export namespace ClientToServer {
    // #region Session lifecycle

    /** First message sent when starting a session */
    export interface Hello extends Payload {
        type: 'hello';
        studentId: string;
        projectId: string;
        sessionId?: string;
        clientVersion: string;
        configHash?: string;
        windowTitle?: string;
    }

    /** Updates about the workspace state, sent regularly and upon change */
    export interface State extends Payload {
        type: 'state';
        focused: boolean;
        activeFile?: FilePath;
        openFiles: FilePath[];
    }
    // #endregion

    // #region Journal

    /** Document snapshot, sent when opening a file or upon request */
    export interface Snapshot extends Payload {
        type: 'snapshot';
        file: FilePath;
        version: number;
        text: string;
        eol: '\n' | '\r\n';
        sha256: string;
        reason: 'open' | 'external' | 'resync';
    }

    /** A change in a document */
    export interface Change {
        offset: number;
        length: number;
        text: string;
    }

    /** A document edit */
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

    /** Update about the current selection(s) */
    export interface Selection extends Payload {
        type: 'selection';
        file: FilePath;
        selections: [from: [line: number, column: number], to: [line: number, column: number]][];
    }

    /** Small checkpoint document hash for the server to compare */
    export interface Checkpoint extends Payload {
        type: 'checkpoint';
        file: FilePath;
        version: number;
        length: number;
        sha256: string;
    }
    // #endregion

    // #region Events

    /** Command execution event */
    export interface Command extends Payload {
        type: 'command';
        invocation: number;
        phase: 'start' | 'end';
        id: string;
        source?: 'keybinding' | 'menu' | 'palette' | 'toolbar' | 'code-action' | 'other';
        args?: unknown;
        ok?: boolean;
    }

    /** Pasted content event */
    export interface Copy extends Payload {
        type: 'copy';
        file: FilePath;
        size: number;
        cut: boolean;
    }

    /** AI chat prompt event */
    export interface AIPrompt extends Payload {
        type: 'ai-prompt';
        feature: string;
        chars: number;
        text?: string;
    }

    /** File operation event */
    export interface FileOp extends Payload {
        type: 'file-op';
        op: 'create' | 'rename' | 'delete' | 'change';
        path: FilePath;
        newPath?: FilePath;
        by: 'ide' | 'disk';
        invocation?: number;
    }

    /** Terminal command execution event */
    export interface Terminal extends Payload {
        type: 'terminal';
        commandLine: string;
        exitCode?: number;
    }

    /** Run event */
    export interface Run extends Payload {
        type: 'run';
        target?: FilePath;
        exitCode?: number;
        durationMs?: number;
    }

    /** Test event */
    export interface Test extends Payload {
        type: 'test';
        results: {
            name: string;
            status: 'passed' | 'failed' | 'error' | 'skipped';
        }[];
        durationMs?: number;
    }

    /** Errors and warnings per file */
    export interface Problems extends Payload {
        type: 'problems';
        byFile: Record<FilePath, { errors: number; warnings: number }>;
    }

    /** Submit event */
    export interface Submit extends Payload {
        type: 'submit';
        ref?: string;
    }
    // #endregion
}

export type ClientToServerPayload =
    | ClientToServer.Hello
    | ClientToServer.State
    | ClientToServer.Snapshot
    | ClientToServer.Edit
    | ClientToServer.Selection
    | ClientToServer.Checkpoint
    | ClientToServer.Command
    | ClientToServer.Copy
    | ClientToServer.AIPrompt
    | ClientToServer.FileOp
    | ClientToServer.Terminal
    | ClientToServer.Run
    | ClientToServer.Test
    | ClientToServer.Problems
    | ClientToServer.Submit;
