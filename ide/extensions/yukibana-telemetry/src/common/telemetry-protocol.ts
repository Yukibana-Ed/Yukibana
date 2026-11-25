/**
 * SPDX-License-Identifier: MIT
 */
import { RpcServer } from '@theia/core';
import { ClientToServerPayload, ServerToClientPayload } from '@yukibana/telemetry-protocol';

export interface LiveSessionContext {
    studentId: string;
    projectId: string;
    clientVersion: string;
    configHash: string;
}

export const LiveTelemetryServicePath = 'yukibana/live-telemetry';
export const LiveTelemetryService = Symbol('LiveTelemetryService');
export interface LiveTelemetryService extends RpcServer<LiveTelemetryClient> {
    start(ctx: Omit<LiveSessionContext, 'studentId'>): void;
    report(payload: ClientToServerPayload): void;
    stop(): void;
}

export interface LiveTelemetryClient {
    onCommand(command: ServerToClientPayload): void;
}

export enum LiveEventPriority {
    NORMAL = 'normal',
    IMPORTANT = 'important',
}
