/**
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, test } from 'vitest';
import { parseExclusion, problemWith } from './release-age-excludes.mts';

const TWO_WEEKS = 20160;
const now = new Date('2026-11-06T12:00:00Z');

describe('which entries name one exact version', () => {
    test.each([
        ['svelte@5.57.3', { name: 'svelte', version: '5.57.3' }],
        ['@types/estree@1.0.10', { name: '@types/estree', version: '1.0.10' }],
        ['next@15.0.0-rc.1', { name: 'next', version: '15.0.0-rc.1' }],
        ['svelte', undefined],
        ['svelte@5', undefined],
        ['svelte@^5.57.3', undefined],
        ['svelte@5.57.3 || 5.57.4', undefined],
        ['@types/*', undefined],
        ['@types/*@1.0.0', undefined],
    ])('%s', (entry, expected) => {
        expect(parseExclusion(entry)).toEqual(expected);
    });
});

describe('when an exclusion has to go', () => {
    test('a release still inside the window keeps its exclusion', () => {
        expect(problemWith('svelte@5.57.3', '2026-10-26T09:00:00.000Z', TWO_WEEKS, now)).toBeUndefined();
    });

    test('a release older than the window is accepted anyway, so its exclusion is removed', () => {
        expect(problemWith('svelte@5.57.3', '2026-10-23T11:59:59.000Z', TWO_WEEKS, now)).toMatch(/remove the entry/);
    });

    test('a release exactly as old as the window is accepted, so its exclusion is removed', () => {
        expect(problemWith('svelte@5.57.3', '2026-10-23T12:00:00.000Z', TWO_WEEKS, now)).toMatch(/remove the entry/);
    });

    test('a range is refused, because it would let in releases nobody reviewed', () => {
        expect(problemWith('svelte@^5.57.3', undefined, TWO_WEEKS, now)).toMatch(/not one exact version/);
    });

    test('a version the registry does not know is a mistake in the entry', () => {
        expect(problemWith('svelte@9.9.9', undefined, TWO_WEEKS, now)).toMatch(/no such version/);
    });

    test('a window that is not a whole number of minutes is a misread setting, not a pass', () => {
        expect(() => problemWith('svelte@5.57.3', '2026-10-26T09:00:00.000Z', Number.NaN, now)).toThrow(/minimumReleaseAge/);
    });
});
