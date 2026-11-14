import { Command, CommandContribution, CommandRegistry, Emitter, MessageService } from '@theia/core';
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

/** The frontend's end of the updater, which the Electron main process tells each state: the last one, and the changes. */
@injectable()
export class UpdaterStateHolder {
    protected current: UpdaterState = { kind: 'off' };
    protected readonly changed = new Emitter<UpdaterState>();
    /** Fires with each state after the first one is recorded. */
    readonly onDidChange = this.changed.event;

    /** The last state the Electron main process reported; `off` until it reports one. */
    get state(): UpdaterState {
        return this.current;
    }

    /** Records `state` and fires {@link onDidChange} with it. */
    onStateChanged(state: UpdaterState): void {
        this.current = state;
        this.changed.fire(state);
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
        this.showStatus(this.holder.state);
        this.holder.onDidChange(state => this.showStatus(state));
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
