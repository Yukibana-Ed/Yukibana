/**
 * SPDX-License-Identifier: MIT
 */
import { MaybePromise, RpcServer } from '@theia/core';
import { ClientToServerPayload, ServerToClientPayload } from '@yukibana/telemetry-protocol';

export interface LiveSessionContext {
    studentId: string;
    projectId: string;
    clientVersion: string;
}

export const LiveTelemetryServicePath = 'yukibana/live-telemetry';
export const LiveTelemetryService = Symbol('LiveTelemetryService');
export interface LiveTelemetryService extends RpcServer<LiveTelemetryClient> {
    start(ctx: Omit<LiveSessionContext, 'studentId'>): MaybePromise<void>;
    report(event: ClientToServerPayload): void;
    stop(): void;
}

export interface LiveTelemetryClient {
    onCommand(command: ServerToClientPayload): void;
}
