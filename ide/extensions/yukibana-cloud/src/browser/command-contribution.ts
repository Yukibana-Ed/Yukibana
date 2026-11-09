/**
 * SPDX-License-Identifier: MIT
 */
import { Command, CommandContribution, CommandRegistry, MessageService, nls } from '@theia/core';
import { inject, injectable } from '@theia/core/shared/inversify';
import { localizeMarkdown } from '@yukibana/ide-common/lib/localize-markdown';
import { CloudAccount, CloudAuth, LoginResult } from '../common/cloud-protocol';
import { CloudAccountService } from './cloud-account-service';
import { AuthClientImpl } from './cloud-auth-client';

/** The command that logs in to the registry in the browser, or says who is logged in already. */
export const LoginCommand: Command = Command.toLocalizedCommand(
    {
        id: 'yukibana.cloudLogin',
        label: 'Log in to cloud registry',
    },
    'yukibana/cloud/login',
);

/** The command that ends this IDE's session with the registry. */
export const LogoutCommand: Command = Command.toLocalizedCommand(
    {
        id: 'yukibana.cloudLogout',
        label: 'Log out of cloud registry',
    },
    'yukibana/cloud/logout',
);

/** The command that logs in again as someone else, ending the current session only once the new one is there. */
export const SwitchAccountCommand: Command = Command.toLocalizedCommand(
    {
        id: 'yukibana.cloudSwitchAccount',
        label: 'Switch cloud registry account',
    },
    'yukibana/cloud/switchAccount',
);

/**
 * The handlers of {@link LoginCommand}, {@link SwitchAccountCommand} and {@link LogoutCommand}. Each tells the person
 * how it went in a notification, unless it rejects; a login shows its progress until it ends, with the code the login
 * page shows when that page was opened from this window (a login joined from another window shows no code here).
 */
@injectable()
export class LoginCommandContribution implements CommandContribution {
    /** The backend that logs in and out. */
    @inject(CloudAuth) protected readonly auth!: CloudAuth;
    /** Where how it went is said. */
    @inject(MessageService) protected readonly messageService!: MessageService;
    /** The account this window uses, asked after a login so the notification can say who it is. */
    @inject(CloudAccountService) protected readonly accounts!: CloudAccountService;
    /** Where the code of a login in progress comes from. */
    @inject(AuthClientImpl) protected readonly authClient!: AuthClientImpl;

    /**
     * Registers the three commands. Each settles once it is over: a login once the backend's login ended, whichever
     * way. A login that fails is a notification, not a rejection; a backend that cannot be reached rejects. Logout
     * rejects, with no notification, when the backend cannot be reached or the keystore fails.
     */
    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand(LoginCommand, {
            execute: async () => {
                // Asks the registry rather than the keystore, which may hold a session the registry no longer accepts
                const state = await this.accounts.refresh();
                if (state.kind === 'logged-in') {
                    this.messageService.info(localizeMarkdown('yukibana/cloud/alreadyLoggedInAs', 'Already logged in as {0}', CloudAccount.label(state.account)));
                    return;
                }
                await this.login(() => this.auth.login());
            },
        });
        commands.registerCommand(SwitchAccountCommand, {
            execute: () => this.login(() => this.auth.switchAccount()),
        });
        commands.registerCommand(LogoutCommand, {
            execute: async () => {
                await this.auth.logout();
                this.messageService.info(nls.localize('yukibana/cloud/logoutSuccessful', 'Logged out successfully'));
            },
        });
    }

    /** Runs `logIn` with progress shown, and says whether it worked and as whom. */
    private async login(logIn: () => Promise<LoginResult>): Promise<void> {
        const progress = await this.messageService.showProgress({ text: nls.localize('yukibana/cloud/loggingIn', 'Logging in...') });
        const showCode = this.authClient.onLoginCode(code =>
            progress.report({
                message: localizeMarkdown('yukibana/cloud/loginCode', 'Continue in your browser; the page there shows the code {0}', code),
            }),
        );
        try {
            const result = await logIn();
            if (!result.ok) {
                this.messageService.error(localizeMarkdown('yukibana/cloud/loginFailed', 'Failed to log in: {0}', result.reason));
                return;
            }
            const state = await this.accounts.refresh();
            this.messageService.info(
                state.kind === 'logged-in'
                    ? localizeMarkdown('yukibana/cloud/loginSuccessfulAs', 'Logged in as {0}', CloudAccount.label(state.account))
                    : nls.localize('yukibana/cloud/loginSuccessful', 'Logged in successfully'),
            );
        } finally {
            showCode.dispose();
            progress.cancel();
        }
    }
}
