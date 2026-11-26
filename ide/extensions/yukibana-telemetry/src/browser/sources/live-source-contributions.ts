import { bindContributionProvider } from '@theia/core';
import { interfaces } from '@theia/core/shared/inversify';
import { LiveTelemetrySourceContribution } from '../../common/telemetry-protocol';
import { EditorEditSource } from './editor-edit-source';
import { ProblemsSource } from './problems-source';
import { SelectionSource } from './selection-source';

type SourceContribution = new (...args: any[]) => LiveTelemetrySourceContribution;

function bindSource(bind: interfaces.Bind, source: SourceContribution) {
    bind(source).toSelf().inSingletonScope();
    bind(LiveTelemetrySourceContribution).toService(source);
}

export function bindLiveSourceContributions(bind: interfaces.Bind): void {
    bindContributionProvider(bind, LiveTelemetrySourceContribution);

    bindSource(bind, ProblemsSource);
    bindSource(bind, EditorEditSource);
    bindSource(bind, SelectionSource);
}
