/**
 * SPDX-License-Identifier: MIT
 */
import { app, net } from '@theia/core/electron-shared/electron';
import { RpcProxy } from '@theia/core/lib/common/messaging/proxy-factory';
import { ElectronMainApplication, ElectronMainApplicationContribution } from '@theia/core/lib/electron-main/electron-main-application';
import { injectable } from '@theia/core/shared/inversify';
import { autoUpdater, ProgressInfo, UpdateInfo } from 'electron-updater';
import { CHECK_INTERVAL_MS, feedOverride, FIRST_CHECK_DELAY_MS, isNewer, releasePage, releaseVersion, RELEASES_REPOSITORY, UpdateMode, updateMode } from '../common/updater-policy';
import { UpdaterClient, UpdaterServer, UpdaterState } from '../common/updater-protocol';

/**
 * The IDE's updater, in the Electron main process. Where the app can update itself ({@link UpdateMode} `auto`),
 * electron-updater downloads a newer release in the background, only the blocks that changed when it can, and installs
 * it when the app quits; the app never restarts by itself. Elsewhere (`manual`) it only finds out whether a newer
 * release exists. It checks {@link FIRST_CHECK_DELAY_MS} after start and every {@link CHECK_INTERVAL_MS}, and tells every
 * window's frontend its {@link UpdaterState}.
 *
 * The releases come from the GitHub releases of {@link RELEASES_REPOSITORY}, as the app's `app-update.yml` (written by
 * electron-builder from `publish` in electron-builder.yml) says, unless `YUKIBANA_UPDATE_FEED` names another feed.
 */
@injectable()
export class UpdaterMainService implements ElectronMainApplicationContribution {
    protected mode: UpdateMode = 'off';
    protected state: UpdaterState = { kind: 'off' };
    protected readonly clients = new Set<UpdaterClient>();
    protected readonly timers: NodeJS.Timeout[] = [];
    protected application: ElectronMainApplication | undefined;
    /** Whether the person asked to restart into the downloaded update, so the quit that follows also relaunches. */
    protected restartRequested = false;

    /** Decides the mode, and in any but `off` schedules the checks; in `auto`, also sets electron-updater up. */
    onStart(application: ElectronMainApplication): void {
        this.application = application;
        this.mode = updateMode({ platform: process.platform, version: app.getVersion(), isPackaged: app.isPackaged, appImage: process.env.APPIMAGE });
        if (this.mode === 'off') {
            return;
        }
        this.setState({ kind: 'idle' });
        if (this.mode === 'auto') {
            this.setUpAutoUpdater();
        }
        const first = setTimeout(() => this.checkNow(), FIRST_CHECK_DELAY_MS);
        const every = setInterval(() => this.checkNow(), CHECK_INTERVAL_MS);
        first.unref();
        every.unref();
        this.timers.push(first, every);
    }

    /** Stops the scheduled checks. */
    onStop(): void {
        this.timers.forEach(timer => clearTimeout(timer));
        this.timers.length = 0;
    }

    /**
     * Returns the {@link UpdaterServer} for one frontend, whose `client` is told the current state at once and every
     * change after, until its connection closes.
     */
    connect(client: RpcProxy<UpdaterClient>): UpdaterServer {
        this.clients.add(client);
        client.onDidCloseConnection(() => this.clients.delete(client));
        client.onStateChanged(this.state);
        return {
            getState: async () => this.state,
            checkNow: () => this.checkNow(),
            restartToUpdate: async () => this.restartToUpdate(),
            setClient: () => {},
            dispose: () => this.clients.delete(client),
        };
    }

    /** See {@link UpdaterServer.checkNow}. Failures become the `failed` state, never an exception. */
    async checkNow(): Promise<void> {
        if (this.mode === 'off' || this.state.kind === 'checking' || this.state.kind === 'downloading' || this.state.kind === 'downloaded') {
            return;
        }
        this.setState({ kind: 'checking' });
        try {
            if (this.mode === 'auto') {
                // The events set the state that follows: downloading, then downloaded, or idle, or failed.
                await autoUpdater.checkForUpdates();
            } else {
                await this.checkManually();
            }
        } catch (e) {
            this.setState({ kind: 'failed', message: e instanceof Error ? e.message : String(e) });
        }
    }

    /** See {@link UpdaterServer.restartToUpdate}. */
    protected restartToUpdate(): void {
        if (this.state.kind !== 'downloaded' || !this.application) {
            return;
        }
        this.restartRequested = true;
        // Closes every window through Theia's close flow, which asks about unsaved changes; a cancel aborts the quit.
        this.application.requestStop();
    }

    /**
     * Configures electron-updater: download in the background, install on quit, never pre-releases, and the feed of
     * `YUKIBANA_UPDATE_FEED` if set. Its events become states. Registers, before electron-updater's own, the quit handler
     * that relaunches the app when the person asked to restart into the update.
     */
    protected setUpAutoUpdater(): void {
        autoUpdater.autoDownload = true;
        autoUpdater.autoInstallOnAppQuit = true;
        autoUpdater.allowPrerelease = false;
        autoUpdater.allowDowngrade = false;
        const feed = feedOverride(process.env);
        if (feed) {
            autoUpdater.setFeedURL({ provider: 'generic', url: feed });
        }
        autoUpdater.on('update-available', (info: UpdateInfo) => this.setState({ kind: 'downloading', version: info.version, percent: 0 }));
        autoUpdater.on('update-not-available', () => this.setState({ kind: 'idle' }));
        autoUpdater.on('download-progress', (progress: ProgressInfo) => {
            if (this.state.kind === 'downloading') {
                this.setState({ ...this.state, percent: Math.floor(progress.percent) });
            }
        });
        autoUpdater.on('update-downloaded', (info: UpdateInfo) => this.setState({ kind: 'downloaded', version: info.version }));
        autoUpdater.on('error', (error: Error) => {
            if (this.state.kind !== 'downloaded') {
                this.setState({ kind: 'failed', message: error.message });
            }
        });
        // 'quit' listeners run in the order they were added, and electron-updater adds its own only once an update is
        // downloaded. Installing here, silently and starting the app after, makes electron-updater's handler skip.
        app.once('quit', (_event, exitCode) => {
            if (this.restartRequested && this.state.kind === 'downloaded' && exitCode === 0) {
                autoUpdater.quitAndInstall(true, true);
            }
        });
    }

    /**
     * Asks GitHub which IDE release is the latest, and sets `available` with its page when it is newer than this app,
     * `idle` otherwise. Throws when GitHub cannot be reached or answers with something else than a release.
     */
    protected async checkManually(): Promise<void> {
        const { owner, repo } = RELEASES_REPOSITORY;
        // github.com's own redirect to the latest release, answered as JSON: not the API, whose anonymous limit is low.
        const response = await net.fetch(`https://github.com/${owner}/${repo}/releases/latest`, { headers: { accept: 'application/json' } });
        if (!response.ok) {
            throw new Error(`GitHub answered ${response.status} for the latest release`);
        }
        const body = (await response.json()) as { tag_name?: unknown };
        const version = typeof body.tag_name === 'string' ? releaseVersion(body.tag_name) : undefined;
        if (version === undefined) {
            throw new Error(`the latest release on GitHub is not an IDE release: ${JSON.stringify(body.tag_name)}`);
        }
        this.setState(isNewer(version, app.getVersion()) ? { kind: 'available', version, url: releasePage(version) } : { kind: 'idle' });
    }

    /** Sets the state and tells every connected frontend. */
    protected setState(state: UpdaterState): void {
        this.state = state;
        for (const client of this.clients) {
            try {
                client.onStateChanged(state);
            } catch {
                // A window that is closing; its connection is about to be dropped.
            }
        }
    }
}
