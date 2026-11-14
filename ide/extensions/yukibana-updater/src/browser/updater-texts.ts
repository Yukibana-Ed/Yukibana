import { nls } from '@theia/core';
import { UpdaterState } from '../common/updater-protocol';

/** The text and tooltip of a status bar item. */
export interface StatusText {
    readonly text: string;
    readonly tooltip: string;
}

/**
 * The status bar item for `state`: one when an update is downloaded ("Restart to update") or, where the app cannot update
 * itself, when a newer version is available to download; undefined in every other state, which show nothing.
 */
export function statusText(state: UpdaterState): StatusText | undefined {
    switch (state.kind) {
        case 'downloaded':
            return {
                text: `$(sync) ${nls.localize('yukibana/updater/restartToUpdate', 'Restart to update to {0}', state.version)}`,
                tooltip: nls.localize(
                    'yukibana/updater/restartToUpdateTooltip',
                    'Yukibana {0} is downloaded. Restart now to use it, or it installs the next time you quit.',
                    state.version,
                ),
            };
        case 'available':
            return {
                text: `$(cloud-download) ${nls.localize('yukibana/updater/available', 'Yukibana {0} is available', state.version)}`,
                tooltip: nls.localize('yukibana/updater/availableTooltip', 'Open the download page of Yukibana {0}', state.version),
            };
        case 'off':
        case 'idle':
        case 'checking':
        case 'downloading':
        case 'failed':
            return undefined;
    }
}

/** What "Check for Updates" tells the person once the check it started is over, for the state it ended in. */
export function checkResultMessage(state: UpdaterState): string | undefined {
    switch (state.kind) {
        case 'idle':
            return nls.localize('yukibana/updater/upToDate', 'Yukibana is up to date.');
        case 'downloading':
            return nls.localize('yukibana/updater/downloading', 'Downloading Yukibana {0} in the background.', state.version);
        case 'failed':
            return nls.localize('yukibana/updater/failed', 'Could not check for updates: {0}', state.message);
        case 'off':
            return nls.localize('yukibana/updater/off', 'This build of Yukibana does not update itself.');
        case 'downloaded':
        case 'available':
            // These show their status bar item.
            return undefined;
        case 'checking':
            // Not an end state.
            return undefined;
    }
}
