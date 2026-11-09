/**
 * SPDX-License-Identifier: MIT
 */
import { bindContributionProvider } from '@theia/core';
import { ContainerModule } from '@theia/core/shared/inversify';
import { YukibanaDefaultIdentityProvider } from '../node/yukibana-default-identity-provider';
import { IdentityProviderContribution, IdentityService } from './identity-service';

/**
 * The Yukibana extension's backend: the {@link IdentityProviderContribution} contribution point, the default identity
 * provider in it, and {@link IdentityService}, each a singleton.
 */
export default new ContainerModule((bind, unbind, isBound, rebind) => {
    bindContributionProvider(bind, IdentityProviderContribution);
    bind(YukibanaDefaultIdentityProvider).toSelf().inSingletonScope();
    bind(IdentityProviderContribution).toService(YukibanaDefaultIdentityProvider);

    bind(IdentityService).toSelf().inSingletonScope();
});
