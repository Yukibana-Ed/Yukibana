/**
 * SPDX-License-Identifier: MIT
 */
import { MaybePromise } from '@theia/core';
import { LiveSessionContext, LiveTelemetrySink, LiveTelemetrySinkHost } from '../common/yukibana-telemetry';

export const LiveTelemetrySinkContribution = Symbol('LiveTelemetrySinkContribution');
export interface LiveTelemetrySinkContribution {
    readonly name: string;
    create(ctx: LiveSessionContext, host: LiveTelemetrySinkHost): MaybePromise<LiveTelemetrySink | undefined>;
}
