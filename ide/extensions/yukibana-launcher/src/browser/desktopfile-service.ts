/********************************************************************************
 * Copyright (C) 2024 STMicroelectronics and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 *
 * SPDX-License-Identifier: MIT
 ********************************************************************************/

import { Endpoint } from '@theia/core/lib/browser';
import { injectable } from '@theia/core/shared/inversify';

/**
 * What the `.desktop` files of the running AppImage need, as `GET /desktopfile/state` answers:
 * - `'up-to-date'`: nothing; also the answer outside an AppImage, without `HOME`, or once the user declined for this AppImage.
 * - `'needs-silent-update'`: the user agreed for this AppImage before, and the files on disk no longer match.
 * - `'needs-prompt'`: the user has not been asked about this AppImage (its path is new).
 *
 * Invariant: the same values as `DesktopFileState` in `node/desktopfile-endpoint.ts`, which is the definition;
 * the two are separate only because browser and node code do not import each other.
 */
export type DesktopFileState = 'up-to-date' | 'needs-silent-update' | 'needs-prompt';

/** What the `.desktop` files are written for. */
export interface DesktopFileOptions {
    /** The application's display name; lowercased with whitespace runs turned into `-`, it also names the files. */
    applicationName: string;
    /** The URL scheme, without `:`, that the URL handler file registers. */
    uriScheme: string;
    /** `false` iff no URL handler file is to be written; absent means `true`. Not read by {@link DesktopFileService.getState}. */
    createUrlHandler?: boolean;
}

/**
 * The frontend's client of the backend's `/desktopfile` endpoint (`YukibanaDesktopFileServiceEndpoint`).
 *
 * Taken from https://github.com/eclipse-theia/theia-ide/blob/master/theia-extensions/launcher/src/browser/desktopfile-service.ts
 */
@injectable()
export class DesktopFileService {
    /**
     * Returns what the `.desktop` files need for `options`.
     *
     * Returns `'needs-prompt'` when the answer has no state (the backend answers 400, with a body that has none, when a
     * name is missing). Rejects when the backend cannot be reached or does not answer JSON.
     */
    async getState(options: DesktopFileOptions): Promise<DesktopFileState> {
        const params = new URLSearchParams({
            applicationName: options.applicationName,
            uriScheme: options.uriScheme,
        });
        const response = await fetch(new Request(`${this.endpoint()}/state?${params}`), { method: 'GET' }).then(r => r.json());
        return response?.state ?? 'needs-prompt';
    }

    /**
     * Asks the backend to write the `.desktop` files for `options` and remember that the user agreed (`create`), or
     * to remember that the user declined for this AppImage (`!create`), and resolves once it has answered.
     *
     * Resolves whatever the backend answered: an error status (400 outside an AppImage, 500 when writing failed or,
     * with `create`, when neither `XDG_DATA_HOME` nor `HOME` is set) is not reported. Rejects only when the backend
     * cannot be reached. There is no timeout.
     *
     * It once did not wait for the request, so its caller logged "updated" before anything was written. A caller that
     * does not await it still does: `CreateLauncherCommandContribution.onStart`, after the yes-or-no prompt.
     */
    async createOrUpdateDesktopfile(create: boolean, options: DesktopFileOptions): Promise<void> {
        await fetch(new Request(`${this.endpoint()}`), {
            body: JSON.stringify({ create, ...options }),
            method: 'PUT',
            headers: new Headers({ 'Content-Type': 'application/json' }),
        });
    }

    /** Returns the endpoint's absolute REST URL, without a trailing slash. */
    protected endpoint(): string {
        const url = new Endpoint({ path: 'desktopfile' }).getRestUrl().toString();
        return url.endsWith('/') ? url.slice(0, -1) : url;
    }
}
