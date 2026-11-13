/**
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, test } from 'vitest';
import { CHECK_INTERVAL_MS, feedOverride, isNewer, releasePage, releaseVersion, UNRELEASED, updateMode, UpdateEnvironment } from './updater-policy';

const packaged: UpdateEnvironment = { platform: 'win32', version: '1.2.3', isPackaged: true, appImage: undefined };

describe('updateMode', () => {
    test('updates a packaged Windows release by itself', () => {
        expect(updateMode(packaged)).toBe('auto');
    });

    test('updates a Linux AppImage by itself, and only points a .deb to the download page', () => {
        expect(updateMode({ ...packaged, platform: 'linux', appImage: '/home/s/Yukibana.AppImage' })).toBe('auto');
        expect(updateMode({ ...packaged, platform: 'linux' })).toBe('manual');
        expect(updateMode({ ...packaged, platform: 'linux', appImage: '' })).toBe('manual');
    });

    test('only points macOS to the download page, since an unsigned app cannot install updates', () => {
        expect(updateMode({ ...packaged, platform: 'darwin' })).toBe('manual');
    });

    test('is off for a development build or an app that is not packaged, on every platform', () => {
        for (const platform of ['win32', 'linux', 'darwin']) {
            expect(updateMode({ ...packaged, platform, version: UNRELEASED })).toBe('off');
            expect(updateMode({ ...packaged, platform, isPackaged: false, appImage: '/x.AppImage' })).toBe('off');
        }
    });
});

describe('feedOverride', () => {
    test('takes an http or https URL from YUKIBANA_UPDATE_FEED, trimmed', () => {
        expect(feedOverride({ YUKIBANA_UPDATE_FEED: ' http://127.0.0.1:8080/feed ' })).toBe('http://127.0.0.1:8080/feed');
        expect(feedOverride({ YUKIBANA_UPDATE_FEED: 'https://example.org/updates' })).toBe('https://example.org/updates');
    });

    test('ignores an unset or empty variable, and anything that is not an http or https URL', () => {
        expect(feedOverride({})).toBeUndefined();
        expect(feedOverride({ YUKIBANA_UPDATE_FEED: '  ' })).toBeUndefined();
        expect(feedOverride({ YUKIBANA_UPDATE_FEED: 'file:///C:/feed' })).toBeUndefined();
        expect(feedOverride({ YUKIBANA_UPDATE_FEED: 'not a url' })).toBeUndefined();
    });
});

describe('releaseVersion', () => {
    test('reads X.Y.Z from an ide-vX.Y.Z tag', () => {
        expect(releaseVersion('ide-v0.1.0')).toBe('0.1.0');
        expect(releaseVersion('ide-v12.0.30')).toBe('12.0.30');
    });

    test('refuses other tags, prereleases and leading zeros', () => {
        for (const tag of ['v0.1.0', 'ide-0.1.0', 'ide-v0.1', 'ide-v0.1.0-beta.1', 'ide-v01.0.0', 'cli-v1.0.0']) {
            expect(releaseVersion(tag)).toBeUndefined();
        }
    });
});

describe('isNewer', () => {
    test('compares X.Y.Z part by part, as numbers', () => {
        expect(isNewer('0.1.1', '0.1.0')).toBe(true);
        expect(isNewer('0.10.0', '0.9.9')).toBe(true);
        expect(isNewer('1.0.0', '0.99.99')).toBe(true);
        expect(isNewer('0.1.0', '0.1.0')).toBe(false);
        expect(isNewer('0.1.0', '0.2.0')).toBe(false);
    });

    test('is false when either is not X.Y.Z, so a development build never sees an update', () => {
        expect(isNewer('0.1.0', UNRELEASED)).toBe(false);
        expect(isNewer('next', '0.1.0')).toBe(false);
    });
});

test('releasePage links the GitHub release of that version', () => {
    expect(releasePage('0.2.0')).toBe('https://github.com/Yukibana-Ed/Yukibana/releases/tag/ide-v0.2.0');
});

test('the app checks again every six hours', () => {
    expect(CHECK_INTERVAL_MS).toBe(6 * 60 * 60 * 1000);
});
