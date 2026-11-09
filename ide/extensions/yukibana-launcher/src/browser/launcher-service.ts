/********************************************************************************
 * Copyright (C) 2022 EclipseSource and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 *
 * SPDX-License-Identifier: MIT
 ********************************************************************************/

import { Endpoint } from '@theia/core/lib/browser';
import { injectable } from '@theia/core/shared/inversify';

/**
 * What the shell launcher `/usr/local/bin/<uriScheme>` needs, as `GET /launcher/state` answers:
 * - `'up-to-date'`: nothing; also the answer outside an AppImage, and once the user declined for this scheme (for
 *   any AppImage, at any path: a "no" is recorded per launcher).
 * - `'needs-silent-update'`: the user agreed for this AppImage before, and the script on disk is missing or differs.
 * - `'needs-prompt'`: the user has not been asked, or agreed for an AppImage at another path.
 *
 * Invariant: the same values as `LauncherEndpointState` in `node/launcher-endpoint.ts`, which is the definition;
 * the two are separate only because browser and node code do not import each other.
 */
export type LauncherEndpointState = 'up-to-date' | 'needs-silent-update' | 'needs-prompt';

/**
 * The frontend's client of the backend's `/launcher` endpoint (`YukibanaLauncherServiceEndpoint`).
 *
 * Taken from https://github.com/eclipse-theia/theia-ide/blob/master/theia-extensions/launcher/src/browser/launcher-service.ts
 */
@injectable()
export class LauncherService {
    /**
     * Returns what the launcher for `uriScheme` (a URL scheme, also the command's name) needs.
     *
     * Returns `'needs-prompt'` when the answer has no state, as the backend's 400 has none (for a `uriScheme` that is
     * not a lowercase URL scheme). Rejects when the backend cannot be reached or does not answer JSON, as when
     * computing the state failed: the backend then answers Express's 500 page, which is HTML. There is no timeout.
     */
    async getState(uriScheme: string): Promise<LauncherEndpointState> {
        const params = new URLSearchParams({ uriScheme });
        const response = await fetch(new Request(`${this.endpoint()}/state?${params}`), { method: 'GET' }).then(r => r.json());
        return response?.state ?? 'needs-prompt';
    }

    /**
     * Asks the backend to install the launcher for `uriScheme` and remember that the user agreed (`create`), or to
     * remember that the user declined (`!create`), and resolves once it has answered.
     *
     * Resolving does not mean the launcher is installed: the backend answers before the administrator password prompt
     * is even answered, and an error status is not reported: 400 for a `uriScheme` that is not a lowercase URL scheme,
     * 500 when `create` is asked outside an AppImage or the AppImage's file is gone. Rejects only when the backend
     * cannot be reached. There is no timeout.
     */
    async createLauncher(create: boolean, uriScheme: string): Promise<void> {
        await fetch(new Request(`${this.endpoint()}`), {
            body: JSON.stringify({ create, uriScheme }),
            method: 'PUT',
            headers: new Headers({ 'Content-Type': 'application/json' }),
        });
    }

    /** Returns the endpoint's absolute REST URL, without a trailing slash. */
    protected endpoint(): string {
        const url = new Endpoint({ path: 'launcher' }).getRestUrl().toString();
        return url.endsWith('/') ? url.slice(0, -1) : url;
    }
}
