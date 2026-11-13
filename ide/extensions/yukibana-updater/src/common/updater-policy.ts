/**
 * SPDX-License-Identifier: MIT
 *
 * When and how the IDE updates itself: pure functions, so that they can be tested without Electron.
 */

/** The repository whose GitHub releases (tagged `ide-v<version>`) carry the IDE's installers and update feeds. */
export const RELEASES_REPOSITORY = { owner: 'Yukibana-Ed', repo: 'Yukibana' } as const;

/** The prefix of the tag of an IDE release, followed by its version: `ide-v1.2.3`. */
export const IDE_TAG_PREFIX = 'ide-v';

/** The version of a build that is not a release, which never looks for updates. */
export const UNRELEASED = '0.0.0-dev';

/** How long after start the first check waits, so that it does not compete with opening the workspace. */
export const FIRST_CHECK_DELAY_MS = 30 * 1000;

/** How often the app checks again while it runs. */
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * How an installation gets newer versions:
 * - `auto`: it downloads them in the background and installs them on quit (Windows' NSIS install, a Linux AppImage);
 * - `manual`: it only checks, and points the person to the release's page (macOS, whose unsigned app cannot install
 *   updates, and a Linux .deb, which its package manager or the person updates);
 * - `off`: it never checks (a development build, or an app that is not packaged).
 */
export type UpdateMode = 'auto' | 'manual' | 'off';

/** What {@link updateMode} decides from. */
export interface UpdateEnvironment {
    /** `process.platform`. */
    readonly platform: string;
    /** The app's version, from its package.json. */
    readonly version: string;
    /** Electron's `app.isPackaged`. */
    readonly isPackaged: boolean;
    /** `process.env.APPIMAGE`: the AppImage's path, set only when the app runs from an AppImage. */
    readonly appImage: string | undefined;
}

/** How the installation described by `env` gets newer versions; see {@link UpdateMode}. */
export function updateMode(env: UpdateEnvironment): UpdateMode {
    if (!env.isPackaged || env.version === UNRELEASED) {
        return 'off';
    }
    if (env.platform === 'win32' || (env.platform === 'linux' && !!env.appImage)) {
        return 'auto';
    }
    return 'manual';
}

/**
 * The update feed that `YUKIBANA_UPDATE_FEED` in `env` names, in place of the GitHub releases: an `http:` or `https:`
 * URL of a folder holding `latest.yml` (or `latest-linux.yml`) and the files it lists, as the release workflow's update
 * test serves. Undefined when the variable is unset, empty, or not such a URL.
 *
 * An environment variable and no setting, because whoever can set it already controls the machine.
 */
export function feedOverride(env: Readonly<Record<string, string | undefined>>): string | undefined {
    const value = env['YUKIBANA_UPDATE_FEED']?.trim();
    if (!value) {
        return undefined;
    }
    try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:' ? value : undefined;
    } catch {
        return undefined;
    }
}

const VERSION = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

/** The version `X.Y.Z` of the IDE release tagged `tag` (`ide-vX.Y.Z`); undefined for any other tag. */
export function releaseVersion(tag: string): string | undefined {
    if (!tag.startsWith(IDE_TAG_PREFIX)) {
        return undefined;
    }
    const version = tag.slice(IDE_TAG_PREFIX.length);
    return VERSION.test(version) ? version : undefined;
}

/** Whether `candidate` is a version `X.Y.Z` higher than `current`, also `X.Y.Z`; false if either is not. */
export function isNewer(candidate: string, current: string): boolean {
    const a = VERSION.exec(candidate);
    const b = VERSION.exec(current);
    if (!a || !b) {
        return false;
    }
    for (let i = 1; i <= 3; i++) {
        const d = Number(a[i]) - Number(b[i]);
        if (d !== 0) {
            return d > 0;
        }
    }
    return false;
}

/** The page of the IDE release `version` on GitHub, where its installers can be downloaded. */
export function releasePage(version: string): string {
    const { owner, repo } = RELEASES_REPOSITORY;
    return `https://github.com/${owner}/${repo}/releases/tag/${IDE_TAG_PREFIX}${version}`;
}
