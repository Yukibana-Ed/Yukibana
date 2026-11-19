/**
 * SPDX-License-Identifier: MIT
 */
import { ConnectionHandler, RpcConnectionHandler } from '@theia/core';
import { ContainerModule } from '@theia/core/shared/inversify';
import { SubmissionService, submissionServicePath } from '../common/submission-protocol';
import { SubmissionServiceImpl } from './submission-service';

/**
 * The submission extension's backend: {@link SubmissionServiceImpl} as the singleton {@link SubmissionService}, served
 * over RPC at {@link submissionServicePath}, and the extension's French translations.
 */
export default new ContainerModule(bind => {
    bind(SubmissionServiceImpl).toSelf().inSingletonScope();
    bind(SubmissionService).toService(SubmissionServiceImpl);
    bind(ConnectionHandler)
        .toDynamicValue(ctx => new RpcConnectionHandler(submissionServicePath, () => ctx.container.get(SubmissionService)))
        .inSingletonScope();
});
