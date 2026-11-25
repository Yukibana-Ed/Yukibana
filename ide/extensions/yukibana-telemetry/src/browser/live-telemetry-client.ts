/**
 * SPDX-License-Identifier: MIT
 */
import { Emitter } from '@theia/core';
import { injectable } from '@theia/core/shared/inversify';
import { ServerToClientPayload } from '@yukibana/telemetry-protocol';
import { LiveTelemetryClient } from '../common/telemetry-protocol';

@injectable()
export class LiveTelemetryClientImpl implements LiveTelemetryClient {
    protected readonly onCommandEmitter = new Emitter<ServerToClientPayload>();
    readonly onCommand$ = this.onCommandEmitter.event;

    onCommand(cmd: ServerToClientPayload): void {
        this.onCommandEmitter.fire(cmd);
    }
}
