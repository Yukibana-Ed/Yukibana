/**
 * SPDX-License-Identifier: MIT
 */
import { RpcServer } from '@theia/core/lib/common/messaging/proxy-factory';

/** The path the Electron main process serves {@link UpdaterServer} on, over Theia's Electron IPC. */
export const UPDATER_PATH = '/services/yukibana-updater';

/** Where the IDE stands with its own updates, as the Electron main process last saw it. */
export type UpdaterState =
    /** This app does not look for updates: a development build, or not packaged. */
    | { readonly kind: 'off' }
    /** No newer version is known: not checked yet, or the last check found none. */
    | { readonly kind: 'idle' }
    /** Asking the release feed whether a newer version exists. */
    | { readonly kind: 'checking' }
    /** Downloading `version` in the background; `percent` is from 0 to 100. */
    | { readonly kind: 'downloading'; readonly version: string; readonly percent: number }
    /** `version` is downloaded and installs when the app quits, or at once on {@link UpdaterServer.restartToUpdate}. */
    | { readonly kind: 'downloaded'; readonly version: string }
    /**
     * `version` is out, but this installation cannot update itself (macOS, which needs a signed app, or a Linux .deb):
     * the person downloads it from `url`, the release's page.
     */
    | { readonly kind: 'available'; readonly version: string; readonly url: string }
    /** The last check or download failed, for the reason in `message`; the next scheduled check tries again. */
    | { readonly kind: 'failed'; readonly message: string };

/** What the frontend is told by the Electron main process. */
export interface UpdaterClient {
    /** Called with each new state, starting with the one current when the client connects. */
    onStateChanged(state: UpdaterState): void;
}

/** The frontend's binding of {@link UpdaterServer}. */
export const UpdaterServer = Symbol('UpdaterServer');

/** The updater in the Electron main process, as the frontend sees it. */
export interface UpdaterServer extends RpcServer<UpdaterClient> {
    /** The current state. */
    getState(): Promise<UpdaterState>;
    /** Checks for a newer version now, unless the updater is off or a check or download is already running. */
    checkNow(): Promise<void>;
    /**
     * When an update is downloaded, quits the app the way closing its windows does (so unsaved changes are asked
     * about, and the quit is cancelled if the person cancels), then installs the update and starts the new version.
     * Does nothing in any other state.
     */
    restartToUpdate(): Promise<void>;
}
