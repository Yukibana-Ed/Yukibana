/**
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, test } from 'vitest';
import { ALLOWED, matches, packageProblems, pluginProblems, satisfies } from './licenses.mts';

describe('which license expressions are accepted', () => {
    test.each([
        ['MIT', true],
        ['GPL-3.0-only', false],
        ['(MIT OR WTFPL)', true],
        ['WTFPL OR ISC', true],
        ['MIT AND GPL-3.0-only', false],
        ['(Apache-2.0 AND MIT)', true],
        ['GPL-3.0-only OR MIT AND ISC', true],
        ['GPL-3.0-only OR MIT AND LGPL-3.0-only', false],
        ['(GPL-3.0-only OR MIT) AND ISC', true],
        ['EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0', false],
        ['MIT OR BSD OR bsd OR GPLv3 OR ISC OR zlib', true],
        ['Unknown', false],
    ])('%s: %s', (expression, expected) => {
        expect(satisfies(expression, ALLOWED)).toBe(expected);
    });

    test('a license with an exception is one license, accepted only as a whole', () => {
        expect(satisfies('GPL-2.0-only WITH Classpath-exception-2.0', new Set(['GPL-2.0-only WITH Classpath-exception-2.0']))).toBe(true);
        expect(satisfies('GPL-2.0-only WITH Classpath-exception-2.0', new Set(['GPL-2.0-only']))).toBe(false);
    });

    test.each(['Public Domain', 'MIT OR', '(MIT', 'MIT)', 'AND MIT', 'MIT WITH'])('%s is not an expression', expression => {
        expect(() => satisfies(expression, ALLOWED)).toThrow(/not a license expression/);
    });
});

test('a pattern with a star matches a family of names, and without one a name exactly', () => {
    expect(matches('@theia/*', '@theia/core')).toBe(true);
    expect(matches('@theia/*', '@theiax/core')).toBe(false);
    expect(matches('jschardet', 'jschardet2')).toBe(false);
});

describe('npm packages', () => {
    test('permissive packages and the reviewed exceptions pass', () => {
        expect(
            packageProblems([
                { name: 'left-pad', versions: ['1.3.0'], license: 'MIT' },
                { name: '@theia/core', versions: ['1.76.0'], license: 'EPL-2.0 OR GPL-2.0-only WITH Classpath-exception-2.0' },
                { name: 'jsonify', versions: ['0.0.1'], license: 'Public Domain' },
            ]),
        ).toEqual([]);
    });

    test('a copyleft package fails, with its versions', () => {
        expect(packageProblems([{ name: 'readline-gpl', versions: ['1.0.0', '2.0.0'], license: 'GPL-3.0-only' }])).toEqual(['readline-gpl@1.0.0, 2.0.0: GPL-3.0-only']);
    });

    test('an exception covers one license: the same package under another one fails', () => {
        expect(packageProblems([{ name: 'jschardet', versions: ['4.0.0'], license: 'GPL-3.0-only' }])).toHaveLength(1);
    });

    test('a package without a license field fails unless it was reviewed', () => {
        expect(packageProblems([{ name: 'mystery', versions: ['0.1.0'], license: 'Unknown' }])).toHaveLength(1);
        expect(packageProblems([{ name: 'khroma', versions: ['2.1.0'], license: 'Unknown' }])).toEqual([]);
    });
});

describe('bundled plugins', () => {
    const declared = ['vscode-builtin-extensions', 'scalameta.metals', 'MS-CEINTL.vscode-language-pack-fr'];
    const downloaded = [
        { id: 'scalameta.metals', manifest: 'Apache-2.0' },
        { id: 'vscode.git', manifest: 'SEE LICENSE IN LICENSE-vscode.txt' },
        { id: 'ms-ceintl.vscode-language-pack-fr', manifest: 'SEE MIT LICENSE IN LICENSE.md' },
    ];

    test('reviewed plugins, and every declared one downloaded, pass', () => {
        expect(pluginProblems(downloaded, declared)).toEqual([]);
    });

    test('a plugin that an extension pack newly pulls in fails until it is reviewed', () => {
        expect(pluginProblems([...downloaded, { id: 'acme.telemetry', manifest: 'MIT' }], declared)).toEqual([expect.stringMatching(/^acme\.telemetry: not reviewed/)]);
    });

    test('a plugin whose license changed since its review fails', () => {
        expect(pluginProblems([{ id: 'scalameta.metals', manifest: 'BUSL-1.1' }], ['scalameta.metals'])).toEqual([expect.stringMatching(/BUSL-1\.1/)]);
    });

    test('a plugin the IDE lists but nothing downloaded fails, so an empty download is no pass', () => {
        expect(pluginProblems([], ['scalameta.metals'])).toEqual([expect.stringMatching(/not in ide\/plugins/)]);
    });
});
