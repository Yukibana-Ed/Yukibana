/********************************************************************************
 * Copyright (C) 2022-2024 EclipseSource and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 *
 * SPDX-License-Identifier: MIT
 ********************************************************************************/

import { ILogger } from '@theia/core/lib/common';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import URI from '@theia/core/lib/common/uri';
import { BackendApplicationContribution } from '@theia/core/lib/node/backend-application';
import { Application, json, Request, Response, Router } from '@theia/core/shared/express';
import { inject, injectable } from '@theia/core/shared/inversify';
import * as sudo from '@vscode/sudo-prompt';
import * as fs from 'fs-extra';
import * as os from 'os';
import * as path from 'path';
import { getStorageFilePath } from './launcher-util';

/**
 * What the shell launcher `/usr/local/bin/<uriScheme>` needs, as `GET /launcher/state` answers:
 * - `'up-to-date'`: nothing; also the answer outside an AppImage, and when the latest answer recorded for this
 *   launcher is a "no", so the user is not asked again.
 * - `'needs-silent-update'`: the latest answer is a "yes" for the running AppImage, and the script on disk is missing
 *   or differs from what {@link YukibanaLauncherServiceEndpoint.buildLauncherScript} makes now.
 * - `'needs-prompt'`: nothing is recorded for this launcher, or the "yes" was for an AppImage at another path.
 *
 * The browser's `LauncherEndpointState` repeats these values and must stay equal to them.
 */
export type LauncherEndpointState = 'up-to-date' | 'needs-silent-update' | 'needs-prompt';

/**
 * The URL schemes the endpoint accepts: a letter, then letters, digits, `+`, `.` or `-` (RFC 3986's scheme, lowercase).
 *
 * The scheme names a file in `/usr/local/bin` that is moved there as root, so a `/` (or a name like `..`) would place
 * a root-owned script outside that folder; anything else is refused with 400 before a path is built from it.
 */
const URI_SCHEME = /^[a-z][a-z0-9+.-]*$/;

interface PathEntry {
    source: string;
    target?: string;
}

/**
 * The backend's `/launcher` REST endpoint: installs the shell launcher `/usr/local/bin/<uriScheme>`, a bash script that
 * starts the running AppImage detached from the terminal, and remembers in `paths.json` (see {@link getStorageFilePath})
 * what the user answered, one entry per launcher.
 *
 * Taken from https://github.com/eclipse-theia/theia-ide/blob/master/theia-extensions/launcher/src/node/launcher-endpoint.ts
 */
@injectable()
export class YukibanaLauncherServiceEndpoint implements BackendApplicationContribution {
    /** The path the endpoint is mounted at. */
    protected static PATH = '/launcher';
    /** The storage file's name: a JSON array of `{ source, target? }`, the launcher's path and, iff the user agreed, the AppImage's. */
    protected static STORAGE_FILE_NAME = 'paths.json';
    /** The backend's logger; injected because the original did, and not used by this class, which writes to the console. */
    @inject(ILogger)
    protected readonly logger: ILogger;

    /** Where the config directory, and so the storage and log files, are. */
    @inject(EnvVariablesServer)
    protected readonly envServer: EnvVariablesServer;

    /**
     * Mounts `PUT /launcher` (body `{ create, uriScheme }`, see `createLauncher`) and `GET /launcher/state?uriScheme=`
     * (answers `{ state }`, a {@link LauncherEndpointState}).
     *
     * Also installs a JSON body parser for the whole application, not only this route, as the original did.
     * Both answer 400 when `uriScheme` is missing or is not a lowercase URL scheme (see {@link URI_SCHEME}); a
     * rejection becomes Express's 500.
     *
     * The handlers are async and Express 4 (what `@theia/core/shared/express` is) only catches a synchronous throw,
     * so each rejection is passed to `next` here: without that, a failure left the request unanswered for good and
     * surfaced only as the process's unhandled rejection.
     */
    configure(app: Application): void {
        const router = Router();
        router.put('/', (request, response, next) => this.createLauncher(request, response).catch(next));
        router.get('/state', (request, response, next) => this.getState(request, response).catch(next));
        app.use(json());
        app.use(YukibanaLauncherServiceEndpoint.PATH, router);
    }

    /**
     * Answers `GET /state`: 400 without a `uriScheme` query parameter matching {@link URI_SCHEME}, otherwise `{ state }`
     * by {@link computeState}. Rejects when `computeState` does (so 500, see {@link configure}).
     */
    protected async getState(request: Request, response: Response): Promise<void> {
        const uriScheme = request.query.uriScheme;
        if (typeof uriScheme !== 'string' || !URI_SCHEME.test(uriScheme)) {
            response.status(400).json({ error: 'uriScheme query parameter is required and must be a lowercase URL scheme' });
            return;
        }
        response.json({ state: await this.computeState(uriScheme) });
    }

    /**
     * Returns what `/usr/local/bin/<uriScheme>` needs, by the latest entry recorded for it (see {@link LauncherEndpointState}).
     * A storage file that cannot be parsed counts as empty.
     *
     * A "no" is recorded per launcher, not per AppImage: once the latest entry for this launcher has no target, the
     * answer is `'up-to-date'` whatever AppImage is running now, also one moved to another path.
     *
     * - Requires: `uriScheme` matches {@link URI_SCHEME}; {@link getState} checks it before calling.
     */
    protected async computeState(uriScheme: string): Promise<LauncherEndpointState> {
        if (!process.env.APPIMAGE) {
            // Not running from an AppImage — nothing to install.
            return 'up-to-date';
        }
        const launcher = `/usr/local/bin/${uriScheme}`;
        const storageFile = await getStorageFilePath(this.envServer, YukibanaLauncherServiceEndpoint.STORAGE_FILE_NAME);
        if (!storageFile) {
            throw new Error('Could not resolve path to storage file.');
        }
        const data = await this.readLauncherPathsFromStorage(storageFile);
        // Latest entry wins so a previous decline followed by a later approve is honored correctly.
        const latest = [...data].reverse().find(entry => entry.source === launcher);
        if (!latest) {
            return 'needs-prompt';
        }
        if (latest.target === undefined) {
            // Previously declined for this scheme — don't re-prompt.
            return 'up-to-date';
        }
        if (latest.target !== process.env.APPIMAGE) {
            // AppImage path changed — ask for consent again.
            return 'needs-prompt';
        }
        // Prior consent recorded for this AppImage — re-apply silently if the on-disk
        // script no longer matches what the current generator would produce.
        const logFile = await this.getLogFilePath();
        const expected = this.buildLauncherScript(process.env.APPIMAGE, logFile);
        return this.fileMatches(launcher, expected) ? 'up-to-date' : 'needs-silent-update';
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
     * Returns the launcher script that runs `target` (the AppImage's path) with the script's arguments, appending its
     * output to `logFile`. Both paths are quoted for bash, so they may hold spaces and quotes.
     *
     * The normal launch path backgrounds the process and redirects to a log file, which would swallow `--help` /
     * `--version` output, so those flags (before any `--`) exec without redirect and the text reaches the terminal.
     * `setsid -f` forks the AppImage into a new session, fully detached from the terminal, so closing the terminal does
     * not prompt about a still-running process and SIGHUP cannot reach the IDE.
     *
     * {@link computeState} compares the file on disk with this, byte for byte: any change here makes every
     * installed launcher `'needs-silent-update'` on the next start.
     */
    protected buildLauncherScript(target: string, logFile: string): string {
        const t = this.bashQuote(target);
        const l = this.bashQuote(logFile);
        return `#!/bin/bash
for arg in "$@"; do
    case "$arg" in
        --) break ;;
        --help|--version|-v) exec ${t} "$@" ;;
    esac
done
setsid -f ${t} "$@" >> ${l} 2>&1 < /dev/null
`;
    }

    private bashQuote(s: string): string {
        return '"' + s.replace(/(["\\$`])/g, '\\$1') + '"';
    }

    private async readLauncherPathsFromStorage(storageFile: string): Promise<PathEntry[]> {
        if (!fs.existsSync(storageFile)) {
            return [];
        }
        try {
            return await fs.readJSON(storageFile);
        } catch (error) {
            console.error('Failed to parse data from "', storageFile, '". Reason:', error);
            return [];
        }
    }

    private async getLogFilePath(): Promise<string> {
        const configDirUri = await this.envServer.getConfigDirUri();
        const logFileUri = new URI(configDirUri).resolve('logs/launcher.log');
        return logFileUri.path.fsPath();
    }

    /**
     * Answers `PUT /`. With `create`, writes the script to a temporary file and starts moving it to
     * `/usr/local/bin/<uriScheme>` behind the operating system's administrator password prompt; without it, installs
     * nothing. Either way replaces what is recorded for that launcher with the answer, and answers 200.
     *
     * The answer is sent, and a "yes" recorded, before the password prompt is answered, and a refused or failed move
     * is not reported: the next start then finds the script missing and asks again (`'needs-silent-update'`).
     *
     * Answers 400, and touches nothing, when `uriScheme` is missing or does not match {@link URI_SCHEME}: it names the
     * file moved into `/usr/local/bin` as root. Rejects (so 500, see {@link configure}), recording nothing, when
     * `create` is asked outside an AppImage or when the AppImage's file is gone; rejects too when the storage file
     * cannot be written.
     */
    private async createLauncher(request: Request, response: Response): Promise<void> {
        const { uriScheme } = request.body;
        if (typeof uriScheme !== 'string' || !URI_SCHEME.test(uriScheme)) {
            response.status(400).json({ error: 'uriScheme is required and must be a lowercase URL scheme' });
            return;
        }
        const shouldCreateLauncher: boolean = !!request.body.create;
        const launcher = `/usr/local/bin/${uriScheme}`;
        const sudoPromptName = uriScheme === 'yukibana-next' ? 'Yukibana Next' : 'Yukibana';
        const target = process.env.APPIMAGE;
        const logFile = await this.getLogFilePath();
        if (shouldCreateLauncher) {
            const targetExists = target && fs.existsSync(target);
            if (!targetExists) {
                throw new Error('Could not find application to launch');
            }
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yukibana-launcher-'));
            const tmpFile = path.join(tmpDir, path.basename(launcher));
            fs.writeFileSync(tmpFile, this.buildLauncherScript(target!, logFile), { mode: 0o755 });
            const command = `mv ${this.bashQuote(tmpFile)} ${this.bashQuote(launcher)} && chmod 755 ${this.bashQuote(launcher)}`;
            sudo.exec(command, { name: sudoPromptName }, () => {
                try {
                    fs.removeSync(tmpDir);
                } catch {
                    /* best effort */
                }
            });
        }

        const storageFile = await getStorageFilePath(this.envServer, YukibanaLauncherServiceEndpoint.STORAGE_FILE_NAME);
        const data = fs.existsSync(storageFile) ? await this.readLauncherPathsFromStorage(storageFile) : [];
        const filtered = data.filter(existing => existing.source !== launcher);
        const entry: PathEntry = shouldCreateLauncher ? { source: launcher, target } : { source: launcher };
        fs.outputJSONSync(storageFile, [...filtered, entry]);

        response.sendStatus(200);
    }
}
