/**
 * SPDX-License-Identifier: MIT
 */
import { Disposable } from '@theia/core';
import { inject } from '@theia/core/shared/inversify';
import { View, ViewContainer } from '@theia/plugin-ext';
import { PluginViewRegistry } from '@theia/plugin-ext/lib/main/browser/view/plugin-view-registry';
import { ConfigProvider } from './config/config-provider';

/**
 * The plugins' view registry, with the config's `layout.containers` and `layout.views`: a container or view set false
 * there is never registered, and a view in a container set false is not either. One not named is registered as usual.
 *
 * It reads the config at registration time, so a plugin view registered before the config is ready is judged by the
 * defaults (registered), and a later change to the config does not add or remove anything.
 */
export class YukibanaPluginViewRegistry extends PluginViewRegistry {
    /** The config whose layout says which containers and views are registered. */
    @inject(ConfigProvider) protected readonly configProvider: ConfigProvider;

    /** Returns `false` iff the config sets the container `containerId` false. */
    protected isContainerEnabled(containerId: string): boolean {
        return this.configProvider.config.layout.containers[containerId] ?? true;
    }

    /** Returns `false` iff the config sets the view `viewId` false. */
    protected isViewEnabled(viewId: string): boolean {
        return this.configProvider.config.layout.views[viewId] ?? true;
    }

    /** Registers `viewContainer` at `location` as Theia does, unless it is disabled; then returns `Disposable.NULL`. */
    registerViewContainer(location: string, viewContainer: ViewContainer): Disposable {
        if (!this.isContainerEnabled(viewContainer.id)) {
            return Disposable.NULL;
        }
        return super.registerViewContainer(location, viewContainer);
    }

    /** Registers `view` in `viewContainerId` as Theia does, unless it or its container is disabled; then returns `Disposable.NULL`. */
    registerView(viewContainerId: string, view: View): Disposable {
        if (!this.isContainerEnabled(viewContainerId) || !this.isViewEnabled(view.id)) {
            return Disposable.NULL;
        }
        return super.registerView(viewContainerId, view);
    }
}
