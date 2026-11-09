/**
 * SPDX-License-Identifier: MIT
 */
import { injectable } from '@theia/core/shared/inversify';
import { YukibanaConfig } from '../../common/yukibana-config';
import { LanguageProviderToggleContribution } from './provider-toggle';

/** Puts code lens providers behind `features.codeLenses`: with it false, no inline actions show in the editor. */
@injectable()
export class CodeLensToggleContribution extends LanguageProviderToggleContribution {
    /** Monaco's `registerCodeLensProvider`. */
    protected readonly registerFunction = 'registerCodeLensProvider';
    /** Returns `config.features.codeLenses`. */
    protected isEnabled(config: YukibanaConfig): boolean {
        return config.features.codeLenses;
    }
}
