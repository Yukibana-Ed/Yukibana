/**
 * SPDX-License-Identifier: MIT
 */
import { Command, CommandContribution, CommandRegistry, DisposableCollection, MenuModelRegistry, MenuPath, nls } from '@theia/core';
import { ContextMenuRenderer, FrontendApplicationContribution, StatusBar, StatusBarAlignment, StatusBarEntry } from '@theia/core/lib/browser';
import { inject, injectable } from '@theia/core/shared/inversify';
import { CloudAccount } from '../common/cloud-protocol';
import { CloudAccountService, CloudAccountState } from './cloud-account-service';
import { LoginCommand, LogoutCommand, SwitchAccountCommand } from './command-contribution';

/**
 * The command that checks who is logged in ({@link CloudAccountService.refresh}), joining a check under way; the
 * account menu's "Try again" after a failed check runs it.
 */
export const RefreshAccountCommand: Command = Command.toLocalizedCommand(
    {
        id: 'yukibana.cloudRefreshAccount',
        label: 'Refresh cloud registry account',
    },
    'yukibana/cloud/refreshAccount',
);

/** The dropdown that opens from the account in the status bar. */
export const ACCOUNT_MENU: MenuPath = ['yukibana_cloud_account_menu'];
/** The account details, shown greyed out above the actions. */
export const ACCOUNT_INFO_GROUP: MenuPath = [...ACCOUNT_MENU, '0_info'];
/** The account's actions (log in, switch account, try again, log out), below the details. */
export const ACCOUNT_ACTIONS_GROUP: MenuPath = [...ACCOUNT_MENU, '1_actions'];

/** The id of the account's status bar item; setting another entry under it replaces the item. */
export const ACCOUNT_STATUS_BAR_ID = 'yukibana-cloud-account';

/**
 * One line of the account menu, as data so the menu for a state can be tested without a menu registry.
 *
 * Invariant, for every item {@link accountMenuItems} returns (the type itself enforces nothing): `group` is
 * {@link ACCOUNT_INFO_GROUP} or {@link ACCOUNT_ACTIONS_GROUP}. An information line's `commandId` is
 * `yukibana.cloudAccountInfo.<key>`, which no other code registers; {@link CloudAccountMenuContribution} registers a
 * never-enabled handler under it only so the menu shows the line. An action's is the id of the command it runs.
 */
export interface AccountMenuItem {
    /** The menu group the line goes in: the greyed-out details, or the actions. */
    readonly group: MenuPath;
    /** The line's text, already localised. */
    readonly label: string;
    /** The id of the command the line runs, or of the never-enabled one that only makes an information line show. */
    readonly commandId: string;
}

const info = (key: string, label: string): AccountMenuItem => ({ group: ACCOUNT_INFO_GROUP, label, commandId: `yukibana.cloudAccountInfo.${key}` });
/** The menu says what the command does in the words of the menu, not the command palette's longer label. */
const action = (command: Command, label: string): AccountMenuItem => ({ group: ACCOUNT_ACTIONS_GROUP, label, commandId: command.id });
const logIn = (): AccountMenuItem => action(LoginCommand, nls.localize('yukibana/cloud/account/logIn', 'Log in'));
const logOut = (): AccountMenuItem => action(LogoutCommand, nls.localize('yukibana/cloud/account/logOut', 'Log out'));

/** The line that says who is logged in: in the menu, and on hover over the status bar. */
function loggedInAs(account: CloudAccount): string {
    return nls.localize('yukibana/cloud/account/loggedInAs', 'Logged in as: {0}', CloudAccount.label(account));
}

/** What the status bar's tooltip and the menu's first line say when nobody is shown as logged in. */
function statusLine(state: Exclude<CloudAccountState, { kind: 'logged-in' }>): string {
    switch (state.kind) {
        case 'logged-out':
            return nls.localize('yukibana/cloud/account/loggedOut', 'Not logged in');
        case 'error':
            return nls.localize('yukibana/cloud/account/unavailable', 'Could not check your account: {0}', state.reason);
        case 'unknown':
            return nls.localize('yukibana/cloud/account/checking', 'Checking your account...');
    }
}

/**
 * Returns the lines of the account menu for `state`, in the order they are shown: first one information line (who is
 * logged in, or the status), then the actions that make sense in that state.
 *
 * Logged in: switch account and log out. Logged out: log in. A failed check: try again and log out, since the session
 * may be fine or may be why the check failed. Still checking: no actions.
 */
export function accountMenuItems(state: CloudAccountState): AccountMenuItem[] {
    switch (state.kind) {
        case 'logged-in':
            return [info('email', loggedInAs(state.account)), action(SwitchAccountCommand, nls.localize('yukibana/cloud/submission/switchAccount', 'Switch account')), logOut()];
        case 'logged-out':
            return [info('status', statusLine(state)), logIn()];
        case 'error':
            // The session may still be fine, or be why it failed: offer both ways on
            return [info('status', statusLine(state)), action(RefreshAccountCommand, nls.localize('yukibana/cloud/account/retry', 'Try again')), logOut()];
        case 'unknown':
            return [info('status', statusLine(state))];
    }
}

/**
 * Returns the status bar item for `state`, on the right: the account's display name when logged in, "Log in" when
 * logged out, a warning when the check failed and a spinner while checking, with a tooltip that says the same at length.
 *
 * `onclick` is called with the native click event, or the item does nothing when clicked if it is undefined.
 */
export function accountStatusBarEntry(state: CloudAccountState, onclick?: (e: MouseEvent) => void): StatusBarEntry {
    const base = { alignment: StatusBarAlignment.RIGHT, priority: 200, onclick };
    if (state.kind === 'logged-in') {
        return { ...base, text: `$(account) ${CloudAccount.displayName(state.account)}`, tooltip: loggedInAs(state.account) };
    }
    const text = {
        'logged-out': `$(account) ${nls.localize('yukibana/cloud/account/logIn', 'Log in')}`,
        error: `$(warning) ${nls.localize('yukibana/cloud/account/unavailableShort', 'Account unavailable')}`,
        unknown: '$(sync~spin) $(account)',
    }[state.kind];
    return { ...base, text, tooltip: statusLine(state) };
}

/** Shows the cloud account in the status bar, with a dropdown of its details and actions. */
@injectable()
export class CloudAccountMenuContribution implements FrontendApplicationContribution, CommandContribution {
    /** The registry the account menu's lines are put in. */
    @inject(MenuModelRegistry) protected readonly menus!: MenuModelRegistry;
    /** The account this window uses. */
    @inject(CloudAccountService) protected readonly accounts!: CloudAccountService;
    /** The registry the information lines' never-enabled commands are put in. */
    @inject(CommandRegistry) protected readonly commands!: CommandRegistry;
    /** The status bar the account item is shown in. */
    @inject(StatusBar) protected readonly statusBar!: StatusBar;
    /** What opens the account menu as a dropdown. */
    @inject(ContextMenuRenderer) protected readonly contextMenus!: ContextMenuRenderer;

    /** The menu lines and information commands of the state shown now, disposed when the state changes. */
    protected readonly menuItems = new DisposableCollection();

    /** Registers {@link RefreshAccountCommand}. */
    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand(RefreshAccountCommand, {
            execute: () => this.accounts.refresh(),
        });
    }

    /** Shows the account as it is known now, keeps it shown as it changes, and asks the registry who is logged in. */
    onStart(): void {
        this.update(this.accounts.state);
        this.accounts.onDidChange(state => this.update(state));
        this.accounts.refresh();
    }

    /** Opens the account menu at the status bar item `click` was on, and asks again who is logged in for next time. */
    protected showMenu(click: MouseEvent): void {
        // Theia passes the native event, whose currentTarget is React's root, not the status bar item clicked
        const item = (click.target instanceof Element && click.target.closest<HTMLElement>('.element')) || document.body;
        const { left, top } = item.getBoundingClientRect();
        this.contextMenus.render({
            menuPath: ACCOUNT_MENU,
            anchor: { x: left, y: top },
            context: item,
            includeAnchorArg: false,
        });
        // An open menu does not change, so this is for the next time it opens
        this.accounts.refresh();
    }

    /** Replaces the status bar item and the menu's lines with those for `state`. */
    protected update(state: CloudAccountState): void {
        this.statusBar.setElement(
            ACCOUNT_STATUS_BAR_ID,
            accountStatusBarEntry(state, e => this.showMenu(e)),
        );
        this.menuItems.dispose();
        for (const [index, item] of accountMenuItems(state).entries()) {
            if (item.group === ACCOUNT_INFO_GROUP) {
                // Menus hide commands without a handler, so information lines get one that is never enabled
                this.menuItems.push(
                    this.commands.registerCommand(
                        { id: item.commandId },
                        {
                            execute: () => undefined,
                            isEnabled: () => false,
                        },
                    ),
                );
            }
            this.menuItems.push(
                this.menus.registerMenuAction(item.group, {
                    commandId: item.commandId,
                    label: item.label,
                    order: String(index),
                }),
            );
        }
    }
}
