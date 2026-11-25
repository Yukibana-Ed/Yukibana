/**
 * SPDX-License-Identifier: MIT
 */
import { DisposableCollection, URI } from '@theia/core';
import { inject, injectable } from '@theia/core/shared/inversify';
import { ProblemManager } from '@theia/markers/lib/browser/problem/problem-manager';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { ClientToServer } from '@yukibana/telemetry-protocol';
import { LiveTelemetrySourceContribution } from '../../common/telemetry-protocol';
import { debounce } from '../../common/utils';
import { LiveTelemetryJournal } from '../live-telemetry-journal';

const DEBOUNCE_MS = 200;

@injectable()
export class ProblemsSource implements LiveTelemetrySourceContribution {
    @inject(LiveTelemetryJournal) protected readonly journal!: LiveTelemetryJournal;
    @inject(ProblemManager) protected readonly problems!: ProblemManager;
    @inject(WorkspaceService) protected readonly workspace!: WorkspaceService;

    protected readonly toDispose = new DisposableCollection();

    start(): void {
        const reportProblems = debounce(() => this.reportProblems(), DEBOUNCE_MS);
        this.toDispose.push(this.problems.onDidChangeMarkers(reportProblems));
    }
    dispose(): void {
        this.toDispose.dispose();
    }

    protected async reportProblems(): Promise<void> {
        const byUri: Record<string, { errors: number; warnings: number }> = {};

        // See https://github.com/eclipse-theia/theia/blob/4f8c4094892dabc1530d23ea94eb7b525acfa28a/packages/markers/src/browser/problem/problem-manager.ts#L35-L49
        for (const marker of this.problems.findMarkers()) {
            byUri[marker.uri] ??= { errors: 0, warnings: 0 };
            if (marker.data.severity === 1) {
                byUri[marker.uri].errors++;
            } else if (marker.data.severity === 2) {
                byUri[marker.uri].warnings++;
            }
        }

        const byFile = Object.fromEntries(
            await Promise.all(
                Object.entries(byUri).map(async ([uri, problems]) => {
                    const path = (await this.workspace.getWorkspaceRelativePath(new URI(uri))).toString();
                    return [path, problems];
                }),
            ),
        );

        this.journal.record({
            type: 'problems',
            byFile,
        } satisfies ClientToServer.Problems);
    }
}
