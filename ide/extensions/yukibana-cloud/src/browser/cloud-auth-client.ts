/**
 * SPDX-License-Identifier: MIT
 */
import { Emitter, ILogger } from '@theia/core';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import { inject, injectable, named } from '@theia/core/shared/inversify';
import { AuthClient } from '../common/cloud-protocol';

/**
 * This window's end of `CloudAuth`, which the backend calls back: it opens the login page outside the IDE and passes
 * on what the backend says about logins to whoever in this window listens.
 */
@injectable()
export class AuthClientImpl implements AuthClient {
    /** Where opening a login page is written down. */
    @inject(ILogger) @named('yukibana:AuthClient') protected readonly logger!: ILogger;
    /** What opens the login page outside the IDE. */
    @inject(WindowService) protected readonly windowService!: WindowService;

    private readonly onLoginChangedEmitter = new Emitter<void>();
    /** Fires when someone logged in or out, possibly in another window; it says nothing about who is logged in now. */
    readonly onLoginChanged = this.onLoginChangedEmitter.event;

    private readonly onLoginCodeEmitter = new Emitter<string>();
    /** Fires with the code the login page shows, when the login just opened has one, right after the page is opened. */
    readonly onLoginCode = this.onLoginCodeEmitter.event;

    /**
     * Opens `url` outside the IDE, then fires {@link AuthClientImpl.onLoginCode} with `code` unless it is undefined or empty.
     *
     * Under Electron the page opens in the system browser; when the IDE runs in a browser it opens in a new tab there,
     * through `window.open`, which a popup blocker may stop since the call comes over RPC and not from a click. Opening
     * is asked of the window service, which does not say whether a page came up, so neither case is reported.
     */
    openLoginUrl(url: string, code?: string): void {
        this.logger.info('Opening login url...');
        this.windowService.openNewWindow(url, { external: true });
        if (code) {
            this.onLoginCodeEmitter.fire(code);
        }
    }

    /** Fires {@link AuthClientImpl.onLoginChanged}. */
    notifyLoginChanged(): void {
        this.onLoginChangedEmitter.fire();
    }
}
