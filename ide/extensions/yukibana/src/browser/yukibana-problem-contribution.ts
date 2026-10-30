/**
 * SPDX-License-Identifier: MIT
 */
import { Command, CommandContribution, CommandRegistry, ILogger } from '@theia/core';
import { inject, injectable, named, postConstruct } from '@theia/core/shared/inversify';
import { ProblemContribution } from '@theia/markers/lib/browser/problem/problem-contribution';
import { ProblemStat } from '@theia/markers/lib/browser/problem/problem-manager';
import { ConfigProvider } from './config/config-provider';

export const FocusProblemsCommand: Command = Command.toDefaultLocalizedCommand({
    id: 'workbench.action.problems.focus',
    label: 'Focus Problems (Errors, Warnings, Infos)',
});

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
        this.configProvider.onConfigChanged(() => this.updateStatusBarElement());
    }

    /** Shows `problemStat` in the status bar as Theia does, or removes the item while squiggles are off. */
    protected setStatusBarElement(problemStat: ProblemStat): void {
        if (this.configProvider.config.features.squiggles === false) {
            void this.statusBar.removeElement('problem-marker-status');
            return;
        }
        super.setStatusBarElement(problemStat);
    }
}

@injectable()
export class YukibanaProblemCommandContribution implements CommandContribution {
    @inject(ProblemContribution) protected readonly problemView: ProblemContribution;

    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand(FocusProblemsCommand, {
            execute: async () => {
                await this.problemView.openView({
                    activate: true,
                    reveal: true,
                });
            },
        });
    }
}
