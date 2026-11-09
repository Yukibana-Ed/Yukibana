/**
 * SPDX-License-Identifier: MIT
 */
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { interfaces } from '@theia/core/shared/inversify';
import { CodeLensToggleContribution } from './code-lens-providers';
import { SuggestionsToggleContribution } from './suggestions-provider';

/**
 * Binds {@link SuggestionsToggleContribution} and {@link CodeLensToggleContribution} as singletons and frontend
 * contributions, so that they replace Monaco's register functions when the frontend initializes.
 *
 * - Requires: called once per container; a second call makes each class ambiguous to resolve, which throws.
 *
 * A provider registered before the contributions' `initialize` runs (by another frontend module's own `initialize`,
 * say) is not switched; plugins register later, and are.
 */
export function bindLanguageProviderContributions(bind: interfaces.Bind): void {
    bind(SuggestionsToggleContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(SuggestionsToggleContribution);

    bind(CodeLensToggleContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(CodeLensToggleContribution);
}
