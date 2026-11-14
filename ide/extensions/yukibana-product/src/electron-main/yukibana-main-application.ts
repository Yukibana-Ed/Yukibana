/**
 * SPDX-License-Identifier: MIT
 */
import { ipcMain } from '@theia/core/electron-shared/electron';
import { StopReason } from '@theia/core/lib/common/frontend-application-state';
import { CHANNEL_APP_STATE_CHANGED } from '@theia/core/lib/electron-common/electron-api';
import { ElectronMainApplication } from '@theia/core/lib/electron-main/electron-main-application';
import { createDisposableListener } from '@theia/core/lib/electron-main/event-utils';
import { injectable } from '@theia/core/shared/inversify';

/**
 * Theia's Electron main application, except that the URL the app was launched with is opened once only, and that the
 * windows can be closed all at once with the outcome known ({@link closeAllWindows}).
 */
@injectable()
export class YukibanaMainApplication extends ElectronMainApplication {
    /**
     * Closes the windows one after another through Theia's close flow, which asks each frontend first (unsaved changes,
     * running tasks), and resolves whether all of them closed. Stops at the first window that refuses, leaving it and
     * the ones after it open; those before it stay closed. Closing the last window quits the app, as any close does.
     *
     * Unlike {@link requestStop}, whose `app.quit()` says nothing when a window refuses, so that a caller can tell a
     * quit that is happening from one that was cancelled.
     */
    async closeAllWindows(): Promise<boolean> {
        for (const window of [...this.windows.values()]) {
            if (!(await window.close(StopReason.Close))) {
                return false;
            }
        }
        return true;
    }

    /**
     * Shows the first window without a URL and opens `urlToOpen`, if any, when a window first reports itself ready,
     * and never again.
     *
     * Theia opens the URL the app was launched with every time its window becomes ready, so again after
     * every reload, e.g. after opening a downloaded project in that window (eclipse-theia/theia#18223).
     */
    protected override showInitialWindow(urlToOpen: string | undefined): void {
        super.showInitialWindow(undefined);
        if (urlToOpen) {
            const listener = createDisposableListener(ipcMain, CHANNEL_APP_STATE_CHANGED, (_event, state) => {
                if (state === 'ready') {
                    listener.dispose();
                    this.openUrl(urlToOpen);
                }
            });
        }
    }
}
