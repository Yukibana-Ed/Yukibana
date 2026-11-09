/**
 * SPDX-License-Identifier: MIT
 */
import { FrontendApplication, FrontendApplicationContribution, Widget } from '@theia/core/lib/browser';
import { inject, injectable } from '@theia/core/shared/inversify';
import { YukibanaConfig } from '../common/yukibana-config';
import { ConfigProvider } from './config/config-provider';

type WidgetFilter = (id: string, config: YukibanaConfig) => boolean;

/**
 * Removes widgets the IDE's students should not have, once the layout is initialized: terminals, the Metals explorer,
 * and the problems view when the config's `features.squiggles` is false.
 *
 * The problems status bar item is not a shell widget, so the `problem-marker-status` filter never matches; that item is
 * hidden by `YukibanaProblemContributioun` instead.
 *
 * It looks once, at the widgets in the shell then, with the first config applied: a widget opened later, or a later
 * change to the config, is not acted on.
 */
@injectable()
export class CleanupFrontendContribution implements FrontendApplicationContribution {
    private _widgetsToRemove: Array<WidgetFilter> = [
        id => id.startsWith('terminal'),
        id => id.endsWith('metals-explorer'),
        (id, config) => config.features.squiggles === false && (id.endsWith('problems') || id.endsWith('problem-marker-status')),
    ];

    /** @param configProvider gives the config the widgets are judged by. */
    constructor(@inject(ConfigProvider) protected readonly configProvider: ConfigProvider) {}

    /** Waits for the first config, then disposes every shell widget one of the filters matches by its id. */
    async onDidInitializeLayout(app: FrontendApplication): Promise<void> {
        const config = await this.configProvider.ready;
        return app.shell.widgets.forEach((widget: Widget) => {
            for (const filter of this._widgetsToRemove) {
                if (filter(widget.id, config)) {
                    widget.dispose();
                }
            }
        });
    }
}
