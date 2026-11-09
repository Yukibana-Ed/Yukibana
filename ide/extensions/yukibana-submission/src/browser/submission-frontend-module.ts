/**
 * SPDX-License-Identifier: MIT
 */
import '../../src/browser/style/index.css';

import { bindContributionProvider, CommandContribution } from '@theia/core';
import { ServiceConnectionProvider } from '@theia/core/lib/browser';
import { ContainerModule } from '@theia/core/shared/inversify';
import { SubmissionService, submissionServicePath } from '../common/submission-protocol';
import { SubmissionTarget } from '../common/submission-target';
import { FileSubmissionTarget } from './file-submission-target';
import { SubmitCommandContribution } from './submission-frontend-contribution';

/**
 * The submission extension's frontend: the submit command, {@link SubmissionService} as an RPC proxy to the backend,
 * the {@link SubmissionTarget} contribution point, and {@link FileSubmissionTarget} as one target. Other extensions add
 * targets by binding them to `SubmissionTarget`.
 */
export default new ContainerModule(bind => {
    bind(CommandContribution).to(SubmitCommandContribution);
    bind(SubmissionService)
        .toDynamicValue(ctx => ServiceConnectionProvider.createProxy<SubmissionService>(ctx.container, submissionServicePath))
        .inSingletonScope();

    bindContributionProvider(bind, SubmissionTarget);
    bind(FileSubmissionTarget).toSelf().inSingletonScope();
    bind(SubmissionTarget).to(FileSubmissionTarget);
});
