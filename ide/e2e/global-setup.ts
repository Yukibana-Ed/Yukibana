/**
 * SPDX-License-Identifier: MIT
 */
import { execFileSync } from 'child_process';

/** The IDE's build CLI. */
const cli = require.resolve('@yukibana/ide/scripts/cli.mts');

/** Builds both apps in development mode, and downloads the plugins unless they are up to date. */
export default function globalSetup(): void {
    for (const command of [['build', '--dev'], ['download:plugins']]) {
        execFileSync(process.execPath, [cli, ...command], { stdio: 'inherit' });
    }
}
