/**
 * SPDX-License-Identifier: MIT
 */
import { LocalizationContribution } from '@theia/core/lib/node/i18n/localization-contribution';
import { ContainerModule } from '@theia/core/shared/inversify';
import { YukibanaLocalizationContribution } from './i18n-localization-contribution';

export default new ContainerModule(bind => {
    bind(YukibanaLocalizationContribution).toSelf().inSingletonScope();
    bind(LocalizationContribution).toService(YukibanaLocalizationContribution);
});
