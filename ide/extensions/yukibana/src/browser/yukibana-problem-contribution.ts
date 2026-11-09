/**
 * SPDX-License-Identifier: MIT
 */

import { ILogger } from '@theia/core';
import { inject, injectable, named, postConstruct } from '@theia/core/shared/inversify';
import { ProblemContribution } from '@theia/markers/lib/browser/problem/problem-contribution';
import { ProblemStat } from '@theia/markers/lib/browser/problem/problem-manager';
import { ConfigProvider } from './config/config-provider';

/**
 * Theia's problems view contribution, without its status bar item while the config's `features.squiggles` is false;
 * the item comes back when it is turned on again.
 *
 * The class name is misspelt (`Contributioun`); the module binds it by that name.
 */
@injectable()
export class YukibanaProblemContributioun extends ProblemContribution {
    /** The config whose `features.squiggles` hides the status bar item. */
    @inject(ConfigProvider) protected readonly configProvider: ConfigProvider;
    /** The contribution's logger; nothing logs to it yet. */
    @inject(ILogger) @named('yukibana:ProblemContribution') protected readonly logger: ILogger;

    /** Updates the status bar item on every config change, for the contribution's lifetime. */
    @postConstruct()
    init(): void {
        this.configProvider.onConfigChanged(e => this.updateStatusBarElement());
    }

    /** Shows `problemStat` in the status bar as Theia does, or removes the item while squiggles are off. */
    protected setStatusBarElement(problemStat: ProblemStat): void {
        if (this.configProvider.config.features.squiggles === false) {
            this.statusBar.removeElement('problem-marker-status');
            return;
        }
        super.setStatusBarElement(problemStat);
    }
}
