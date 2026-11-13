/**
 * SPDX-License-Identifier: MIT
 */
import { Command, CommandContribution, CommandRegistry, MessageService } from '@theia/core';
import { FrontendApplicationContribution, StatusBar, StatusBarAlignment } from '@theia/core/lib/browser';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import { inject, injectable } from '@theia/core/shared/inversify';
import { UpdaterServer, UpdaterState } from '../common/updater-protocol';
import { checkResultMessage, statusText } from './updater-texts';

/** The status bar item's id. */
const STATUS_ID = 'yukibana-updater';

/** The updater's commands. */
export namespace UpdaterCommands {
    const CATEGORY = 'Yukibana';
    /** Checks for a newer IDE now, and says what it found. */
    export const CHECK = Command.toLocalizedCommand({ id: 'yukibana.updater.check', label: 'Check for IDE Updates', category: CATEGORY }, 'yukibana/updater/checkCommand');
    /** Restarts into the downloaded update; shown only once one is downloaded. */
    export const RESTART = Command.toLocalizedCommand(
        { id: 'yukibana.updater.restart', label: 'Restart to Update the IDE', category: CATEGORY },
        'yukibana/updater/restartCommand',
    );
}

/** The frontend's end of the updater: the state it was last told, and a way to wait for the next one. */
@injectable()
export class UpdaterStateHolder {
    protected current: UpdaterState = { kind: 'off' };
    protected listeners: ((state: UpdaterState) => void)[] = [];

    /** The last state the Electron main process reported. */
    get state(): UpdaterState {
        return this.current;
    }

    /** Records `state` and calls every listener with it. */
    onStateChanged(state: UpdaterState): void {
        this.current = state;
        for (const listener of this.listeners) {
            listener(state);
        }
    }

    /** Calls `listener` with every later state, until the returned function is called. */
    listen(listener: (state: UpdaterState) => void): () => void {
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter(l => l !== listener);
        };
    }
}

/** The "Restart to update" (or "available") status bar item, and the Check for Updates and Restart to Update commands. */
@injectable()
export class UpdaterFrontendContribution implements FrontendApplicationContribution, CommandContribution {
    @inject(UpdaterServer) protected readonly server!: UpdaterServer;
    @inject(UpdaterStateHolder) protected readonly holder!: UpdaterStateHolder;
    @inject(StatusBar) protected readonly statusBar!: StatusBar;
    @inject(MessageService) protected readonly messages!: MessageService;
    @inject(WindowService) protected readonly windowService!: WindowService;

    /** Keeps the status bar item in step with the state, from the state current at start on. */
    onStart(): void {
        this.holder.listen(state => this.showStatus(state));
        this.server.getState().then(
            state => this.holder.onStateChanged(state),
            () => {
                // No updater in this window's main process (e.g. while it closes): nothing to show.
            },
        );
    }

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(UpdaterCommands.CHECK, {
            execute: () => this.checkNow(),
        });
        registry.registerCommand(UpdaterCommands.RESTART, {
            isEnabled: () => this.holder.state.kind === 'downloaded',
            isVisible: () => this.holder.state.kind === 'downloaded',
            execute: () => this.server.restartToUpdate(),
        });
    }

    /** Shows the item for `state`, or removes it when `state` has none. */
    protected showStatus(state: UpdaterState): void {
        const entry = statusText(state);
        if (!entry) {
            this.statusBar.removeElement(STATUS_ID);
            return;
        }
        this.statusBar.setElement(STATUS_ID, {
            ...entry,
            alignment: StatusBarAlignment.RIGHT,
            priority: 200,
            onclick: () => this.onStatusClick(),
        });
    }

    /** Restarts into a downloaded update, or opens the release page of one available to download by hand. */
    protected onStatusClick(): void {
        const state = this.holder.state;
        if (state.kind === 'downloaded') {
            void this.server.restartToUpdate();
        } else if (state.kind === 'available') {
            this.windowService.openNewWindow(state.url, { external: true });
        }
    }

    /**
     * Checks now, and tells the person where things stand once the check is over: the server's `checkNow` resolves when
     * it has an answer (a download it starts goes on in the background), or at once when it has nothing to check.
     */
    protected async checkNow(): Promise<void> {
        await this.server.checkNow();
        const state = await this.server.getState();
        const message = checkResultMessage(state);
        if (message) {
            await (state.kind === 'failed' ? this.messages.warn(message) : this.messages.info(message));
        }
    }
}
