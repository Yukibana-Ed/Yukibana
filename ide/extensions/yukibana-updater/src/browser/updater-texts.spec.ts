import { describe, expect, test } from 'vitest';
import { UpdaterState } from '../common/updater-protocol';
import { checkResultMessage, statusText } from './updater-texts';

const states: UpdaterState[] = [
    { kind: 'off' },
    { kind: 'idle' },
    { kind: 'checking' },
    { kind: 'downloading', version: '0.2.0', percent: 40 },
    { kind: 'downloaded', version: '0.2.0' },
    { kind: 'available', version: '0.2.0', url: 'https://github.com/Yukibana-Ed/Yukibana/releases/tag/ide-v0.2.0' },
    { kind: 'failed', message: 'offline' },
];

describe('statusText', () => {
    test('shows an item only once an update is downloaded, or available to download by hand', () => {
        const shown = states.filter(state => statusText(state) !== undefined).map(state => state.kind);
        expect(shown).toEqual(['downloaded', 'available']);
    });

    test('offers to restart into the downloaded version', () => {
        expect(statusText({ kind: 'downloaded', version: '0.2.0' })?.text).toBe('$(sync) Restart to update to 0.2.0');
    });

    test('names the version available to download', () => {
        expect(statusText({ kind: 'available', version: '0.3.1', url: 'u' })?.text).toBe('$(cloud-download) Yukibana 0.3.1 is available');
    });
});

describe('checkResultMessage', () => {
    test('says something after a check in every end state without a status bar item', () => {
        expect(checkResultMessage({ kind: 'idle' })).toBe('Yukibana is up to date.');
        expect(checkResultMessage({ kind: 'downloading', version: '0.2.0', percent: 0 })).toBe('Downloading Yukibana 0.2.0 in the background.');
        expect(checkResultMessage({ kind: 'failed', message: 'offline' })).toBe('Could not check for updates: offline');
        expect(checkResultMessage({ kind: 'off' })).toBe('This build of Yukibana does not update itself.');
    });

    test('leaves the downloaded and available states to their status bar item', () => {
        expect(checkResultMessage({ kind: 'downloaded', version: '0.2.0' })).toBeUndefined();
        expect(checkResultMessage({ kind: 'available', version: '0.2.0', url: 'u' })).toBeUndefined();
    });
});
