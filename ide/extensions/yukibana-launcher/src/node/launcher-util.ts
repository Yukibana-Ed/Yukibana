/********************************************************************************
 * Copyright (C) 2024 STMicroelectronics and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the MIT License, which is available in the project root.
 *
 * SPDX-License-Identifier: MIT
 ********************************************************************************/

import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import URI from '@theia/core/lib/common/uri';

/**
 * Returns the filesystem path of `fileName` in the launcher's global storage,
 * `<config dir>/globalStorage/yukibana-launcher/<fileName>`, where the endpoints remember what the user answered.
 *
 * Never empty, and creates nothing: a caller writing there makes the folders (`fs.outputJSONSync` does).
 *
 * - Requires: `fileName` is a non-empty relative path with no `..` segment. Rejects with an `Error` otherwise (before reading
 *   anything), since the name is appended as a string and resolved, so an absolute or `..` name would point outside the folder. Both callers
 *   pass constants.
 *
 * Taken from https://github.com/eclipse-theia/theia-ide/blob/master/theia-extensions/launcher/src/node/launcher-util.ts
 */
export async function getStorageFilePath(envServer: EnvVariablesServer, fileName: string): Promise<string> {
    if (fileName === '' || fileName.startsWith('/') || fileName.startsWith('\\') || /^[a-zA-Z]:/.test(fileName) || fileName.split(/[\\/]/).includes('..')) {
        throw new Error(`Storage file name must be a relative path inside the launcher's storage: ${JSON.stringify(fileName)}`);
    }
    const configDirUri = await envServer.getConfigDirUri();
    const globalStorageFolderUri = new URI(configDirUri).resolve('globalStorage/yukibana-launcher/' + fileName);
    const globalStorageFolderFsPath = globalStorageFolderUri.path.fsPath();
    return globalStorageFolderFsPath;
}
