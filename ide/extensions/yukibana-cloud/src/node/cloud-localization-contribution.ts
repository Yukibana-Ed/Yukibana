/**
 * SPDX-License-Identifier: MIT
 */
import { LocalizationContribution, LocalizationRegistry } from '@theia/core/lib/node/i18n/localization-contribution';
import { injectable } from '@theia/core/shared/inversify';

/** The cloud extension's translations of its own strings. */
@injectable()
export class YukibanaCloudLocalizationContribution implements LocalizationContribution {
    /** Registers the French strings, from `i18n/nls.fr.json`; English is the source text and needs none. */
    async registerLocalizations(registry: LocalizationRegistry): Promise<void> {
        registry.registerLocalizationFromRequire('fr', require('../../i18n/nls.fr.json'));
    }
}
