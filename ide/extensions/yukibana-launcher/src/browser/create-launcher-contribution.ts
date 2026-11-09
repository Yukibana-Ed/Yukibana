/********************************************************************************
 * Copyright (C) 2022-2024 EclipseSource and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 *
 * SPDX-License-Identifier: MIT
 ********************************************************************************/

import { ConfirmDialog, Dialog, FrontendApplication, FrontendApplicationContribution, StorageService } from '@theia/core/lib/browser';
import { FrontendApplicationConfigProvider } from '@theia/core/lib/browser/frontend-application-config-provider';
import { Command, CommandContribution, CommandRegistry, ILogger, MaybePromise } from '@theia/core/lib/common';
import { nls } from '@theia/core/lib/common/nls';
import { inject, injectable } from '@theia/core/shared/inversify';
import { DesktopFileService } from './desktopfile-service';
import { LauncherService } from './launcher-service';

/** The commands this extension contributes. */
export namespace LauncherCommands {
    /**
     * The command that asks the user to confirm, then installs or refreshes the shell launcher
     * `/usr/local/bin/<uriScheme>` for the running AppImage, behind an administrator password prompt.
     */
    export const CREATE_LAUNCHER: Command = {
        id: 'yukibana.launcher.create',
        label: 'Create CLI Launcher',
        category: 'Yukibana',
    };
}

/**
 * Offers, when the frontend starts, to install the shell launcher and the `.desktop` files of the running AppImage,
 * keeps them current without asking again once the user has agreed, and contributes {@link LauncherCommands.CREATE_LAUNCHER}.
 *
 * The backend decides what is needed (see `LauncherEndpointState` and `DesktopFileState`); outside an AppImage it
 * answers `'up-to-date'` and nothing is shown.
 *
 * Taken from https://github.com/eclipse-theia/theia-ide/blob/master/theia-extensions/launcher/src/browser/create-launcher-contribution.ts
 */
@injectable()
export class CreateLauncherCommandContribution implements FrontendApplicationContribution, CommandContribution {
    /** The frontend's storage service; injected because the original did, and not read by this class. */
    @inject(StorageService)
    protected readonly storageService: StorageService;

    /** Where this contribution says what it did. */
    @inject(ILogger)
    protected readonly logger: ILogger;

    @inject(LauncherService) private readonly launcherService: LauncherService;

    @inject(DesktopFileService) private readonly desktopFileService: DesktopFileService;

    /**
     * Starts two independent checks, of the shell launcher and of the `.desktop` files, and returns at once, without
     * waiting for either or for any dialog.
     *
     * For each, by the state the backend gives: `'up-to-date'` does nothing; `'needs-silent-update'` rewrites what was
     * agreed to before (the launcher after a short confirmation, because the administrator password prompt follows;
     * the `.desktop` files without asking); `'needs-prompt'` asks yes or no and sends the answer either way, so that a
     * "no" is recorded. The launcher's "no" is recorded per launcher (per scheme) and not asked again for any AppImage,
     * also one at another path; the `.desktop` files' "no" is recorded per AppImage path, so an AppImage moved
     * elsewhere is asked again. Refusing the `'needs-silent-update'` heads-up records nothing, so it is shown again on
     * every start until the user confirms.
     *
     * The `'needs-prompt'` branches do not await the answer they send, so "Initialized application launcher." and
     * "Created or updated .desktop file." are logged before the backend has answered, and whatever it answered.
     *
     * Neither check reports failure to the user: a backend that cannot be reached, or answers with something that is
     * not JSON (as Express's 500 page when computing the state failed), leaves an unhandled rejection, and a failed
     * install is not detected (the request resolves on any HTTP status).
     */
    onStart(_app: FrontendApplication): MaybePromise<void> {
        const appConfig = FrontendApplicationConfigProvider.get();
        const applicationName = appConfig.applicationName;
        const uriScheme = appConfig.electron.uriScheme;

        this.launcherService.getState(uriScheme).then(async state => {
            if (state === 'up-to-date') {
                this.logger.info('Application launcher already up to date.');
                return;
            }
            if (state === 'needs-silent-update') {
                // Prior consent recorded. We still show a brief heads-up before the OS
                // sudo prompt fires so the user knows what the password request is for.
                const confirmed = await this.confirmLauncherUpdate(uriScheme, true);
                if (confirmed) {
                    await this.launcherService.createLauncher(true, uriScheme);
                    this.logger.info('Application launcher updated to match current template.');
                } else {
                    this.logger.info('Application launcher update declined by user.');
                }
                return;
            }
            const messageContainer = document.createElement('div');
            messageContainer.textContent = nls.localizeByDefault(
                `Would you like to install a shell command that launches the application?\nYou will be able to run ${applicationName} from the command line by typing '${uriScheme}'.`,
            );
            messageContainer.setAttribute('style', 'white-space: pre-line');
            const details = document.createElement('p');
            details.textContent = 'Administrator privileges are required, you will need to enter your password next.';
            messageContainer.appendChild(details);
            const dialog = new ConfirmDialog({
                title: nls.localizeByDefault('Create launcher'),
                msg: messageContainer,
                ok: Dialog.YES,
                cancel: Dialog.NO,
            });
            const install = await dialog.open();
            this.launcherService.createLauncher(!!install, uriScheme);
            this.logger.info('Initialized application launcher.');
        });

        this.desktopFileService.getState({ applicationName, uriScheme }).then(async state => {
            if (state === 'up-to-date') {
                this.logger.info('Desktop file already up to date.');
                return;
            }
            if (state === 'needs-silent-update') {
                await this.desktopFileService.createOrUpdateDesktopfile(true, {
                    applicationName,
                    createUrlHandler: true,
                    uriScheme,
                });
                this.logger.info('Desktop file silently updated to match current launcher template.');
                return;
            }
            const messageContainer = document.createElement('div');
            messageContainer.textContent = nls.localizeByDefault(
                `Would you like to create a .desktop file for ${applicationName}?\nThis will make it easier to open ${applicationName} directly\nfrom your applications menu and enables further features.`,
            );
            messageContainer.setAttribute('style', 'white-space: pre-line');
            const dialog = new ConfirmDialog({
                title: nls.localizeByDefault('Create .desktop file'),
                msg: messageContainer,
                ok: Dialog.YES,
                cancel: Dialog.NO,
            });
            const install = await dialog.open();
            this.desktopFileService.createOrUpdateDesktopfile(!!install, {
                applicationName,
                createUrlHandler: true,
                uriScheme,
            });
            this.logger.info('Created or updated .desktop file.');
        });
    }

    /**
     * Registers {@link LauncherCommands.CREATE_LAUNCHER}. Executing it asks for confirmation and, if given, asks the
     * backend to install the launcher for the frontend's configured `uriScheme`; it logs success whatever the
     * backend answered, since `LauncherService.createLauncher` does not report failure (outside an AppImage, or when
     * the AppImage's file is gone, the backend answers 500), and before the administrator password prompt is answered.
     */
    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand(LauncherCommands.CREATE_LAUNCHER, {
            execute: async () => {
                const uriScheme = FrontendApplicationConfigProvider.get().electron.uriScheme;
                const confirmed = await this.confirmLauncherUpdate(uriScheme, false);
                if (!confirmed) {
                    return;
                }
                await this.launcherService.createLauncher(true, uriScheme);
                this.logger.info('CLI launcher created or updated via command.');
            },
        });
    }

    /**
     * Shows a dialog saying the launcher at `/usr/local/bin/<uriScheme>` is about to be created or refreshed (`isUpdate`
     * picks the wording) and that a password prompt follows, and returns `true` iff the user confirmed.
     */
    protected async confirmLauncherUpdate(uriScheme: string, isUpdate: boolean): Promise<boolean> {
        const messageContainer = document.createElement('div');
        messageContainer.textContent = isUpdate
            ? `The CLI launcher at /usr/local/bin/${uriScheme} needs to be refreshed to match the current application.`
            : `This will create or refresh the CLI launcher at /usr/local/bin/${uriScheme}.`;
        messageContainer.setAttribute('style', 'white-space: pre-line');
        const details = document.createElement('p');
        details.textContent = 'Administrator privileges are required, you will be prompted for your password next.';
        messageContainer.appendChild(details);
        const dialog = new ConfirmDialog({
            title: nls.localizeByDefault(isUpdate ? 'Update CLI launcher' : 'Create CLI launcher'),
            msg: messageContainer,
            ok: nls.localizeByDefault('Confirm'),
            cancel: nls.localizeByDefault('Abort'),
        });
        return !!(await dialog.open());
    }
}
