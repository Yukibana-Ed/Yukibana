/**
 * SPDX-License-Identifier: MIT
 */
import { ContributionProvider, Disposable, ILogger } from '@theia/core';
import { inject, injectable, named } from '@theia/core/shared/inversify';
import { LiveSessionContext, LiveTelemetry, LiveTelemetryClient, LiveTelemetryService, LiveTelemetrySink, LiveTelemetrySinkHost } from '../common/yukibana-telemetry';
import { LiveTelemetrySinkContribution } from './live-telemetry-sink-contribution';

@injectable()
export class LiveTelemetryServiceImpl implements LiveTelemetryService, LiveTelemetrySinkHost, Disposable {
    @inject(ContributionProvider) @named(LiveTelemetrySinkContribution) protected readonly sinkContributions!: ContributionProvider<LiveTelemetrySinkContribution>;
    @inject(ILogger) @named('yukibana:LiveTelemetryService') protected readonly logger!: ILogger;

    protected client: LiveTelemetryClient | undefined;
    protected sinks: LiveTelemetrySink[] = [];

    async start(ctx: LiveSessionContext): Promise<void> {
        for (const contribution of this.sinkContributions.getContributions()) {
            const sink = await contribution.create(ctx, this);
            if (sink !== undefined) {
                this.sinks.push(sink);
            } else {
                void this.logger.warn(`Sink ${contribution.name} not created`);
            }
        }
    }

    report(event: LiveTelemetry.ClientToServerPayload): void {
        this.sinks.forEach(sink => sink.send(event));
    }

    dispose(): void {
        this.stop();
    }

    stop(): void {
        this.sinks.forEach(sink => sink.dispose());
        this.sinks = [];
    }

    setClient(client: LiveTelemetryClient | undefined): void {
        this.client = client;
    }

    getClient(): LiveTelemetryClient | undefined {
        return this.client;
    }

    dispatch(command: LiveTelemetry.ServerToClientPayload): void {
        this.client?.onCommand(command);
    }
}
