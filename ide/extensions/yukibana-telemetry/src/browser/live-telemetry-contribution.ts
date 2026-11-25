/**
 * SPDX-License-Identifier: MIT
 */
import { ContributionProvider, MaybePromise } from '@theia/core';
import { FrontendApplication, FrontendApplicationContribution } from '@theia/core/lib/browser';
import { inject, injectable, named } from '@theia/core/shared/inversify';
import { LiveTelemetrySourceContribution } from '../common/telemetry-protocol';
import { LiveTelemetryPolicy } from './live-telemetry-policy';

@injectable()
export class LiveTelemetryContribution implements FrontendApplicationContribution {
    @inject(ContributionProvider) @named(LiveTelemetrySourceContribution) protected readonly sources!: ContributionProvider<LiveTelemetrySourceContribution>;
    @inject(LiveTelemetryPolicy) protected readonly policy!: LiveTelemetryPolicy;

    onStart(_app: FrontendApplication): MaybePromise<void> {
        for (const source of this.sources.getContributions()) {
            source.start();
        }
    }
}
