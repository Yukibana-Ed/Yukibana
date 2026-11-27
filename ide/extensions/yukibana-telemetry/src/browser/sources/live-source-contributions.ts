import { bindContributionProvider } from '@theia/core';
import { interfaces } from '@theia/core/shared/inversify';
import { LiveTelemetrySourceContribution } from '../../common/telemetry-protocol';
import { EditorEditSource } from './editor-edit-source';
import { ExecutionSource } from './execution-source';
import { FileSystemSource } from './file-system-source';
import { ProblemsSource } from './problems-source';
import { SelectionSource } from './selection-source';
import { WorkbenchStateSource } from './workbench-state-source';

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
    bindSource(bind, WorkbenchStateSource);
    bindSource(bind, ExecutionSource);
    bindSource(bind, FileSystemSource);
}
