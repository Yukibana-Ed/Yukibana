/**
 * SPDX-License-Identifier: MIT
 */
import { LocalizationContribution, LocalizationRegistry } from '@theia/core/lib/node/i18n/localization-contribution';
import { injectable } from '@theia/core/shared/inversify';

/** Contributes the telemetry extension's translations, from its `i18n` folder. */
@injectable()
export class YukibanaTelemetryLocalizationContribution implements LocalizationContribution {
    /**
     * Registers the French translations, `i18n/nls.fr.json`. Rejects when that file is missing from the package; in a
     * bundled (webpacked) backend the build fails on it first, so this happens only when run unbundled.
     */
    async registerLocalizations(registry: LocalizationRegistry): Promise<void> {
        registry.registerLocalizationFromRequire('fr', require('../../i18n/nls.fr.json'));
    }
}
