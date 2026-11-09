/********************************************************************************
 * Copyright (C) 2024 STMicroelectronics and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 *
 * SPDX-License-Identifier: MIT
 ********************************************************************************/

import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { BackendApplicationContribution } from '@theia/core/lib/node/backend-application';
import { Application, json, Request, Response, Router } from '@theia/core/shared/express';
import { inject, injectable } from '@theia/core/shared/inversify';
import { execFile } from 'child_process';
import * as fs from 'fs-extra';
import * as path from 'path';
import { getStorageFilePath } from './launcher-util';

/**
 * What the `.desktop` files of the running AppImage need, as `GET /desktopfile/state` answers:
 * - `'up-to-date'`: nothing; also the answer outside an AppImage, without `HOME`, and once the user declined for
 *   this AppImage's path.
 * - `'needs-silent-update'`: the user agreed for this AppImage's path before, and the launcher or URL handler file on
 *   disk is missing or differs from what would be written now.
 * - `'needs-prompt'`: the user has not been asked about this AppImage's path.
 *
 * The browser's `DesktopFileState` repeats these values and must stay equal to them.
 */
export type DesktopFileState = 'up-to-date' | 'needs-silent-update' | 'needs-prompt';

interface DesktopFileInformation {
    appImage: string;
    declined: string[];
}

/**
 * The backend's `/desktopfile` REST endpoint: writes the running AppImage's `<appId>-launcher.desktop`, its
 * `<appId>-launcher-url.desktop` URL handler and its icon into the XDG applications folder, and remembers in
 * `desktopfile.json` (see {@link getStorageFilePath}) the AppImage the user last agreed for and those they declined.
 * `appId` is the application name lowercased, with each run of whitespace turned into `-`.
 *
 * Taken from https://github.com/eclipse-theia/theia-ide/blob/master/theia-extensions/launcher/src/node/desktopfile-endpoint.ts
 */
@injectable()
export class YukibanaDesktopFileServiceEndpoint implements BackendApplicationContribution {
    /** The path the endpoint is mounted at. */
    protected static PATH = '/desktopfile';
    /** The storage file's name: JSON `{ appImage, declined }`, the AppImage path last agreed for (`''` if none) and those declined. */
    protected static STORAGE_FILE_NAME = 'desktopfile.json';

    /** Where the config directory, and so the storage file, is. */
    @inject(EnvVariablesServer)
    protected readonly envServer: EnvVariablesServer;

    /**
     * Mounts `PUT /desktopfile` (body `{ create, applicationName, uriScheme, createUrlHandler? }`, see
     * `createOrUpdateDesktopfile`) and `GET /desktopfile/state?applicationName=&uriScheme=` (answers `{ state }`, a
     * {@link DesktopFileState}).
     *
     * Also installs a JSON body parser for the whole application, not only this route, as the original did.
     * Both answer 400 when a name is missing; a rejection becomes Express's 500.
     *
     * The handlers are async and Express 4 (what `@theia/core/shared/express` is) only catches a synchronous throw,
     * so each rejection is passed to `next` here: without that, a failure left the request unanswered for good and
     * surfaced only as the process's unhandled rejection.
     */
    configure(app: Application): void {
        const router = Router();
        router.put('/', (request, response, next) => this.createOrUpdateDesktopfile(request, response).catch(next));
        router.get('/state', (request, response, next) => this.getState(request, response).catch(next));
        app.use(json());
        app.use(YukibanaDesktopFileServiceEndpoint.PATH, router);
    }

    /**
     * Answers `GET /state`: 400 without both query parameters, otherwise `{ state }` by {@link computeState}.
     * Rejects when `computeState` does (so 500, see {@link configure}).
     */
    protected async getState(request: Request, response: Response): Promise<void> {
        const applicationName = request.query.applicationName;
        const uriScheme = request.query.uriScheme;
        if (typeof applicationName !== 'string' || typeof uriScheme !== 'string') {
            response.status(400).json({ error: 'applicationName and uriScheme query parameters are required' });
            return;
        }
        response.json({ state: await this.computeState(applicationName, uriScheme) });
    }

    /**
     * Returns what the `.desktop` files for `applicationName` and `uriScheme` need (see {@link DesktopFileState}).
     * A storage file that cannot be parsed counts as absent. Logs to the console, and answers `'up-to-date'`, when
     * `HOME` is unset.
     */
    protected async computeState(applicationName: string, uriScheme: string): Promise<DesktopFileState> {
        if (!process.env.APPIMAGE) {
            return 'up-to-date';
        }
        if (process.env.HOME === undefined) {
            console.error('Desktop files can only be created if there is a set HOME directory');
            return 'up-to-date';
        }
        const storageFile = await getStorageFilePath(this.envServer, YukibanaDesktopFileServiceEndpoint.STORAGE_FILE_NAME);
        if (!storageFile) {
            throw new Error('Could not resolve path to storage file.');
        }
        const info = await this.readAppImageInformationFromStorage(storageFile);
        if (!info || info.appImage !== process.env.APPIMAGE) {
            return info?.declined?.includes(process.env.APPIMAGE) ? 'up-to-date' : 'needs-prompt';
        }
        // Prior consent recorded for this AppImage — re-apply silently if the on-disk
        // files no longer match what the current launcher template would render.
        return this.isOnDiskUpToDate(applicationName, uriScheme) ? 'up-to-date' : 'needs-silent-update';
    }

    /**
     * Returns what `storageFile` records, or `undefined` when it does not exist or is not JSON (logged).
     * Its shape is not checked.
     */
    protected async readAppImageInformationFromStorage(storageFile: string): Promise<DesktopFileInformation | undefined> {
        if (!fs.existsSync(storageFile)) {
            return undefined;
        }
        try {
            const data: DesktopFileInformation = await fs.readJSON(storageFile);
            return data;
        } catch (error) {
            console.error('Failed to parse data from "', storageFile, '". Reason:', error);
            return undefined;
        }
    }

    /**
     * Answers `PUT /`. With `create`, copies the icon into the applications folder unless it is there (from `$APPDIR`,
     * `<appId>-electron-app.png` or else any `.png` there, warning when there is none), writes the launcher file and,
     * unless `createUrlHandler` is `false`, the URL handler file, records the AppImage as agreed for, and refreshes the
     * desktop database (see {@link refreshDesktopDatabase}). Without it, adds the AppImage to those declined.
     * Answers 200 once done.
     *
     * Answers 400 when a name is missing, or when not running from an AppImage: it once wrote `Exec=undefined` there.
     *
     * - Requires: with `create`, `XDG_DATA_HOME` or `HOME` is set. Unlike `GET /state`, which answers `'up-to-date'`
     *   without `HOME`, this does not check it first: {@link getApplicationsDir} throws a `TypeError`, nothing is
     *   written or recorded, and the request rejects (so 500, see {@link configure}). A decline needs neither.
     *
     * Rejects (so 500) too when a file cannot be written; files written before the failing one stay.
     */
    protected async createOrUpdateDesktopfile(request: Request, response: Response): Promise<void> {
        const { applicationName, uriScheme } = request.body;
        if (typeof applicationName !== 'string' || typeof uriScheme !== 'string') {
            response.status(400).json({ error: 'applicationName and uriScheme are required' });
            return;
        }
        const appImage = process.env.APPIMAGE;
        if (!appImage) {
            response.status(400).json({ error: 'desktop files are only made when running from an AppImage' });
            return;
        }
        const createOrUpdate: boolean = !!request.body.create;
        const createUrlHandler: boolean = request.body.createUrlHandler !== false;
        const appId = this.getAppId(applicationName);

        const storageFile = await getStorageFilePath(this.envServer, YukibanaDesktopFileServiceEndpoint.STORAGE_FILE_NAME);
        let appImageInformation: DesktopFileInformation | undefined = await this.readAppImageInformationFromStorage(storageFile);
        if (appImageInformation === undefined) {
            appImageInformation = { appImage: '', declined: [] };
        }

        if (createOrUpdate) {
            const iconFileName = appId + '-electron-app.png';
            const applicationsDir = this.getApplicationsDir();
            fs.ensureDirSync(applicationsDir);
            const imagePath = path.join(applicationsDir, iconFileName);
            if (!fs.existsSync(imagePath)) {
                const appDir = process.env.APPDIR;
                if (appDir !== undefined) {
                    let unpackedImagePath = path.join(appDir, iconFileName);
                    if (!fs.existsSync(unpackedImagePath)) {
                        // Fallback: find any .png icon in the AppImage root
                        try {
                            const pngFile = fs.readdirSync(appDir).find((f: string) => f.endsWith('.png'));
                            if (pngFile) {
                                unpackedImagePath = path.join(appDir, pngFile);
                            }
                        } catch {
                            /* ignore */
                        }
                    }
                    if (fs.existsSync(unpackedImagePath)) {
                        fs.copyFileSync(unpackedImagePath, imagePath);
                    } else {
                        console.warn('Launcher Icon not Found in App Image');
                    }
                } else {
                    console.warn('Path for unpacked App Image not found');
                }
            }

            const desktopFilePath = path.join(applicationsDir, `${appId}-launcher.desktop`);
            fs.outputFileSync(desktopFilePath, this.getDesktopFileContents(applicationName, appImage, imagePath));

            const urlDesktopFileName = `${appId}-launcher-url.desktop`;
            if (createUrlHandler) {
                const desktopURLFilePath = path.join(applicationsDir, urlDesktopFileName);
                fs.outputFileSync(desktopURLFilePath, this.getDesktopURLFileContents(applicationName, appImage, imagePath, uriScheme));
            }

            appImageInformation.appImage = appImage;
            fs.outputJSONSync(storageFile, appImageInformation);

            await this.refreshDesktopDatabase(applicationsDir, createUrlHandler ? { uriScheme, urlDesktopFileName } : undefined);
        } else {
            appImageInformation.declined.push(appImage);
            fs.outputJSONSync(storageFile, appImageInformation);
        }

        response.sendStatus(200);
    }

    /**
     * Returns the launcher `.desktop` file that starts `appImagePath` with the files or URLs it is given, under
     * `applicationName`, with the icon at `imagePath`. {@link isOnDiskUpToDate} compares the file on disk with this.
     */
    protected getDesktopFileContents(applicationName: string, appImagePath: string, imagePath: string): string {
        return `[Desktop Entry]
Name=${applicationName}
GenericName=Integrated Development Environment
Exec=${appImagePath} %U
Terminal=false
Type=Application
Icon=${imagePath}
StartupWMClass=${this.getAppId(applicationName)}
Comment=IDE for cloud and desktop
Categories=Development;IDE;`;
    }

    /**
     * Returns the hidden `.desktop` file that handles `<uriScheme>:` URLs by running `appImagePath --open-url <url>`.
     * {@link isOnDiskUpToDate} compares the file on disk with this.
     */
    protected getDesktopURLFileContents(applicationName: string, appImagePath: string, imagePath: string, uriScheme: string): string {
        return `[Desktop Entry]
Name=${applicationName} - URL Handler
GenericName=Integrated Development Environment
Exec=${appImagePath} --open-url %U
Terminal=false
Type=Application
NoDisplay=true
Icon=${imagePath}
MimeType=x-scheme-handler/${uriScheme};
Comment=IDE for cloud and desktop
Categories=Development;IDE;`;
    }

    /** Returns the id that names the files: `applicationName` lowercased, each run of whitespace turned into `-`. */
    protected getAppId(applicationName: string): string {
        return applicationName.toLowerCase().replace(/\s+/g, '-');
    }

    /**
     * Returns the folder `.desktop` files go in, by the XDG Base Directory spec.
     * Throws a `TypeError` when neither `XDG_DATA_HOME` nor `HOME` is set.
     */
    protected getApplicationsDir(): string {
        // XDG Base Directory Spec: $XDG_DATA_HOME/applications, falling back to
        // $HOME/.local/share/applications when XDG_DATA_HOME is unset or empty.
        const xdgDataHome = process.env.XDG_DATA_HOME || path.join(process.env.HOME!, '.local', 'share');
        return path.join(xdgDataHome, 'applications');
    }

    /**
     * Returns `true` iff both the launcher and the URL handler file on disk are exactly what would be written now for
     * the running AppImage. The URL handler is required even though `createUrlHandler: false` skips writing it; the
     * frontend always asks for one.
     *
     * - Requires: `APPIMAGE` is set; not checked, as its only caller has.
     */
    protected isOnDiskUpToDate(applicationName: string, uriScheme: string): boolean {
        const appId = this.getAppId(applicationName);
        const applicationsDir = this.getApplicationsDir();
        const imagePath = path.join(applicationsDir, `${appId}-electron-app.png`);
        const launcherPath = path.join(applicationsDir, `${appId}-launcher.desktop`);
        const urlPath = path.join(applicationsDir, `${appId}-launcher-url.desktop`);
        const expectedLauncher = this.getDesktopFileContents(applicationName, process.env.APPIMAGE!, imagePath);
        const expectedUrl = this.getDesktopURLFileContents(applicationName, process.env.APPIMAGE!, imagePath, uriScheme);
        return this.fileMatches(launcherPath, expectedLauncher) && this.fileMatches(urlPath, expectedUrl);
    }

    /** Returns `true` iff `filePath` can be read and holds exactly `expectedContents`, as UTF-8. */
    protected fileMatches(filePath: string, expectedContents: string): boolean {
        try {
            return fs.readFileSync(filePath, 'utf8') === expectedContents;
        } catch {
            return false;
        }
    }

    /**
     * Refreshes the desktop database of `applicationsDir` and, given `urlHandler`, makes its file the default for its
     * scheme, so `xdg-open` and `gio open` route the scheme to the fresh file at once. Does nothing off Linux.
     *
     * Best effort: never rejects; a command that fails or takes over 5 seconds is logged to the console.
     */
    protected async refreshDesktopDatabase(applicationsDir: string, urlHandler?: { uriScheme: string; urlDesktopFileName: string }): Promise<void> {
        if (process.platform !== 'linux') {
            return;
        }
        const tasks: Promise<void>[] = [this.runCommand('update-desktop-database', [applicationsDir])];
        if (urlHandler) {
            tasks.push(this.runCommand('xdg-mime', ['default', urlHandler.urlDesktopFileName, `x-scheme-handler/${urlHandler.uriScheme}`]));
        }
        await Promise.all(tasks);
    }

    /** Runs `command` with `args`, without a shell, for at most 5 seconds; resolves either way and logs a failure. */
    protected runCommand(command: string, args: string[]): Promise<void> {
        return new Promise(resolve => {
            execFile(command, args, { timeout: 5000 }, error => {
                if (error) {
                    console.warn(`Launcher: '${command} ${args.join(' ')}' failed:`, error.message);
                }
                resolve();
            });
        });
    }
}
