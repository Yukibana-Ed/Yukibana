/**
 * SPDX-License-Identifier: MIT
 */
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { interfaces } from '@theia/core/shared/inversify';
import { LiveDocumentStreamer } from './live-document-streamer';
import { StatsAggregator } from './stats-aggregator';
import { TestWatcher } from './test-watcher';

export function bindTelemetryContribution(bind: interfaces.Bind): void {
    bind(StatsAggregator).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(StatsAggregator);

    bind(LiveDocumentStreamer).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(LiveDocumentStreamer);

    bind(TestWatcher).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(TestWatcher);
}
