/**
 * SPDX-License-Identifier: MIT
 */

import { injectable } from '@theia/core/shared/inversify';
import { YukibanaConfig } from '../../common/yukibana-config';
import { LanguageProviderToggleContribution } from './provider-toggle';

/**
 * Puts completion item providers behind `features.codeSuggestions`: with it false, the editor offers no completions.
 * A provider's `triggerCharacters` still start a request, which gets nothing.
 */
@injectable()
export class SuggestionsToggleContribution extends LanguageProviderToggleContribution {
    /** Monaco's `registerCompletionItemProvider`. */
    protected readonly registerFunction = 'registerCompletionItemProvider';
    /** Returns `config.features.codeSuggestions`. */
    protected isEnabled(config: YukibanaConfig): boolean {
        return config.features.codeSuggestions;
    }
}
