/**
 * SPDX-License-Identifier: MIT
 */
import { LocalizationContribution, LocalizationRegistry } from '@theia/core/lib/node/i18n/localization-contribution';
import { ContainerModule, injectable } from '@theia/core/shared/inversify';

/** Registers the updater's French strings, from `i18n/nls.fr.json`; English is the source text and needs none. */
@injectable()
export class UpdaterLocalizationContribution implements LocalizationContribution {
    async registerLocalizations(registry: LocalizationRegistry): Promise<void> {
        registry.registerLocalizationFromRequire('fr', require('../../i18n/nls.fr.json'));
    }
}

/** The updater's backend: only its translations, which Theia serves to the frontend from the backend. */
export default new ContainerModule(bind => {
    bind(UpdaterLocalizationContribution).toSelf().inSingletonScope();
    bind(LocalizationContribution).toService(UpdaterLocalizationContribution);
});
