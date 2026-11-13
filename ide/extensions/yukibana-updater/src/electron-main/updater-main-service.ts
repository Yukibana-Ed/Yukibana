/**
 * SPDX-License-Identifier: MIT
 */
import { app, net } from '@theia/core/electron-shared/electron';
import { RpcProxy } from '@theia/core/lib/common/messaging/proxy-factory';
import { ElectronMainApplication, ElectronMainApplicationContribution } from '@theia/core/lib/electron-main/electron-main-application';
import { injectable } from '@theia/core/shared/inversify';
import { YukibanaMainApplication } from '@yukibana/ide-product-ext/lib/electron-main/yukibana-main-application';
import { AppImageUpdater, AppUpdater, autoUpdater, ProgressInfo, UpdateInfo } from 'electron-updater';
import { CHECK_INTERVAL_MS, feedOverride, FIRST_CHECK_DELAY_MS, isNewer, releasePage, releaseVersion, RELEASES_REPOSITORY, UpdateMode, updateMode } from '../common/updater-policy';
import { UpdaterClient, UpdaterServer, UpdaterState } from '../common/updater-protocol';

/** How long the manual check waits for GitHub before it gives up. */
const MANUAL_CHECK_TIMEOUT_MS = 60 * 1000;

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
    /** electron-updater's updater for this platform, in `auto` mode only. */
    protected updater: AppUpdater | undefined;
    /** The check running now, which a later {@link checkNow} waits for instead of starting another. */
    protected running: Promise<void> | undefined;
    /**
     * Whether the person asked to restart into the downloaded update and every window agreed to close, so the quit that
     * follows also starts the new version. Cleared as soon as a window refuses to close.
     */
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
            this.updater = this.createUpdater();
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
            restartToUpdate: () => this.restartToUpdate(),
            setClient: () => {},
            dispose: () => this.clients.delete(client),
        };
    }

    /**
     * See {@link UpdaterServer.checkNow}: resolves once the check has an answer, also when it joins one already running.
     * Failures become the `failed` state, never an exception.
     */
    checkNow(): Promise<void> {
        if (this.running) {
            return this.running;
        }
        if (this.mode === 'off' || this.state.kind === 'downloading' || this.state.kind === 'downloaded') {
            return Promise.resolve();
        }
        this.running = this.check().finally(() => {
            this.running = undefined;
        });
        return this.running;
    }

    /** One check, setting `checking` and then the state it ends in. */
    protected async check(): Promise<void> {
        this.setState({ kind: 'checking' });
        try {
            if (this.updater) {
                // The events set the state that follows: downloading, then downloaded, or idle, or failed.
                const result = await this.updater.checkForUpdates();
                // A failed download is reported by the 'error' event; this only keeps its rejection from going unhandled.
                result?.downloadPromise?.catch(() => {});
            } else {
                await this.checkManually();
            }
        } catch (e) {
            this.setState({ kind: 'failed', message: e instanceof Error ? e.message : String(e) });
        }
    }

    /**
     * See {@link UpdaterServer.restartToUpdate}. Closes the windows one by one through Theia's close flow; the last one
     * closing quits the app, and the quit handler of {@link createUpdater} installs and relaunches. If a window refuses,
     * the windows before it stay closed, the app keeps running, and a later quit installs without relaunching.
     */
    protected async restartToUpdate(): Promise<void> {
        if (this.state.kind !== 'downloaded' || !this.application) {
            return;
        }
        this.restartRequested = true;
        if (this.application instanceof YukibanaMainApplication) {
            if (!(await this.application.closeAllWindows())) {
                this.restartRequested = false;
            }
        } else {
            // Without the product's application, a refusal cannot be seen: a cancelled restart leaves the request set.
            this.application.requestStop();
        }
    }

    /**
     * electron-updater's updater for this platform: download in the background, install on quit, never pre-releases,
     * and the feed of `YUKIBANA_UPDATE_FEED` if set. Its events become states. Also registers, before the updater's own,
     * the quit handler that relaunches the app when the person asked to restart into the update.
     *
     * On Linux always the AppImage updater (`auto` there means an AppImage): electron-updater's `autoUpdater` would pick
     * the .deb updater whenever the app's resources say `package-type: deb`, which electron-builder also writes into the
     * AppImage when it builds both from the same folder.
     */
    protected createUpdater(): AppUpdater {
        const updater: AppUpdater = process.platform === 'linux' ? new AppImageUpdater() : autoUpdater;
        updater.autoDownload = true;
        updater.autoInstallOnAppQuit = true;
        updater.allowPrerelease = false;
        updater.allowDowngrade = false;
        const feed = feedOverride(process.env);
        if (feed) {
            updater.setFeedURL({ provider: 'generic', url: feed });
        }
        updater.on('update-available', (info: UpdateInfo) => this.setState({ kind: 'downloading', version: info.version, percent: 0 }));
        updater.on('update-not-available', () => this.setState({ kind: 'idle' }));
        updater.on('download-progress', (progress: ProgressInfo) => {
            if (this.state.kind === 'downloading') {
                this.setState({ ...this.state, percent: Math.floor(progress.percent) });
            }
        });
        updater.on('update-downloaded', (info: UpdateInfo) => this.setState({ kind: 'downloaded', version: info.version }));
        updater.on('error', (error: Error) => {
            if (this.state.kind !== 'downloaded') {
                this.setState({ kind: 'failed', message: error.message });
            }
        });
        // 'quit' listeners run in the order they were added, and the updater adds its own only once an update is
        // downloaded. Installing here, silently and starting the app after, makes the updater's own handler skip.
        app.once('quit', (_event, exitCode) => {
            if (this.restartRequested && this.state.kind === 'downloaded' && exitCode === 0) {
                updater.quitAndInstall(true, true);
            }
        });
        return updater;
    }

    /**
     * Asks GitHub which IDE release is the latest, and sets `available` with its page when it is newer than this app,
     * `idle` otherwise. Throws when GitHub cannot be reached in {@link MANUAL_CHECK_TIMEOUT_MS} or answers with something
     * else than an IDE release.
     */
    protected async checkManually(): Promise<void> {
        const { owner, repo } = RELEASES_REPOSITORY;
        // github.com's own redirect to the latest release, answered as JSON: not the API, whose anonymous limit is low.
        const response = await net.fetch(`https://github.com/${owner}/${repo}/releases/latest`, {
            headers: { accept: 'application/json' },
            signal: AbortSignal.timeout(MANUAL_CHECK_TIMEOUT_MS),
        });
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
