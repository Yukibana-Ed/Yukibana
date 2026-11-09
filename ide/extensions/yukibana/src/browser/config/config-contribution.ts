/**
 * SPDX-License-Identifier: MIT
 */
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { interfaces } from '@theia/core/shared/inversify';
import { ConfigProvider } from './config-provider';
import { ReadOnlyPolicy } from './read-only-policy';

/**
 * Binds {@link ReadOnlyPolicy} and {@link ConfigProvider} as singletons, and the provider as a frontend contribution so
 * that it loads the config on start.
 *
 * - Requires: called once per container. After a second call both classes are bound twice, and resolving either throws
 *   an ambiguous-match error.
 */
export function bindConfig(bind: interfaces.Bind): void {
    bind(ReadOnlyPolicy).toSelf().inSingletonScope();
    bind(ConfigProvider).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(ConfigProvider);
}
