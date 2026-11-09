/**
 * SPDX-License-Identifier: MIT
 */
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { interfaces } from '@theia/core/shared/inversify';
import { StatsAggregator } from './stats-aggregator';

export function bindTelemetryContribution(bind: interfaces.Bind): void {
    bind(StatsAggregator).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(StatsAggregator);
}
