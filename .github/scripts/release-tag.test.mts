import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { PACKAGES, check, compareVersions, parseTag, releasedVersions } from './release-tag.mts';

describe('parseTag', () => {
    test('reads the package and the version of a release tag', () => {
        expect(parseTag('client-v0.1.0')).toEqual({ kind: 'client', version: '0.1.0' });
        expect(parseTag('cli-v1.10.0')).toEqual({ kind: 'cli', version: '1.10.0' });
        expect(parseTag('ide-v0.3.0')).toEqual({ kind: 'ide', version: '0.3.0' });
    });

    test.each(['v0.3.0', 'ide-0.3.0', 'ide-v0.3', 'ide-v0.3.0-beta.1', 'cli-v01.0.0', 'cloud-v1.0.0', ' cli-v1.0.0', ''])('%j is not a release tag', tag => {
        expect(parseTag(tag)).toBeUndefined();
    });
});

test('versions compare by number, not by text', () => {
    expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compareVersions('2.0.0', '2.0.0')).toBe(0);
    expect(() => compareVersions('1.0', '1.0.0')).toThrow(/not X\.Y\.Z/);
});

test('the IDE counts its own tags and the old v ones; the npm packages only their own', () => {
    const tags = ['v0.1.0', 'v0.2.0', 'ide-v0.3.0', 'cli-v1.0.0', 'client-v0.4.0', 'vscode-thing'];
    expect(releasedVersions('ide', tags)).toEqual(['0.1.0', '0.2.0', '0.3.0']);
    expect(releasedVersions('cli', tags)).toEqual(['1.0.0']);
    expect(releasedVersions('client', tags)).toEqual(['0.4.0']);
});

describe('check', () => {
    const tags = ['v0.1.0', 'v0.2.0', 'cli-v1.0.0', 'cli-v1.2.0'];

    test('a first release of a package, or one past its newest, may go', () => {
        expect(check('client-v0.1.0', tags, [])).toEqual({ ok: true, kind: 'client', version: '0.1.0' });
        expect(check('cli-v1.2.1', tags, ['1.0.0', '1.2.0'])).toEqual({ ok: true, kind: 'cli', version: '1.2.1' });
        expect(check('ide-v0.3.0', tags, [])).toEqual({ ok: true, kind: 'ide', version: '0.3.0' });
    });

    test('a tag that is not a release tag is refused, naming the shapes allowed', () => {
        expect(check('cli-1.3.0', tags, [])).toEqual({ ok: false, reason: expect.stringContaining('cli-vX.Y.Z') });
    });

    test('a tag that exists is refused: a version is released once', () => {
        expect(check('cli-v1.2.0', tags, ['1.2.0'])).toEqual({ ok: false, reason: expect.stringContaining('exists already') });
    });

    test('a version npm has without its tag is refused, pointing to the re-run that only tags', () => {
        expect(check('cli-v1.3.0', tags, ['1.2.0', '1.3.0'])).toEqual({ ok: false, reason: expect.stringContaining('re-run the failed jobs') });
    });

    test('a version not higher than the newest release is refused, the IDE’s old v0.2.0 included', () => {
        expect(check('cli-v1.1.0', tags, [])).toEqual({ ok: false, reason: expect.stringMatching(/1\.1\.0.*1\.2\.0/) });
        expect(check('ide-v0.2.0', tags, [])).toMatchObject({ ok: false });
        expect(check('ide-v0.1.5', tags, [])).toEqual({ ok: false, reason: expect.stringContaining('0.2.0') });
    });
});

test('every package Release knows exists under its folder, with that name, at the development version', () => {
    for (const p of Object.values(PACKAGES)) {
        const manifest: unknown = JSON.parse(readFileSync(new URL(`../../${p.dir}/package.json`, import.meta.url), 'utf8'));
        expect(manifest).toMatchObject({ name: p.name, version: '0.0.0-dev' });
    }
});
