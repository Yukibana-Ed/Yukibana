/**
 * SPDX-License-Identifier: MIT
 */
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { PLACEHOLDERS, PRODUCTION_FILES, placeholdersIn, report } from './production-config.mts';

describe('the production configuration', () => {
    test('a file with every value filled in has no placeholder left', () => {
        expect(placeholdersIn([{ file: 'wrangler.jsonc', text: '{ "id": "0123abcd" }\n' }])).toEqual([]);
    });

    test('every placeholder left is found, with its file and line', () => {
        const found = placeholdersIn([
            { file: 'a', text: 'ok\nref = "REPLACE_ME_PROJECT_REF"\n' },
            { file: 'b', text: 'https://REPLACE_ME_PROJECT_REF.supabase.co https://x.REPLACE_ME_WORKERS_SUBDOMAIN.workers.dev' },
        ]);
        expect(found).toEqual([
            { name: 'REPLACE_ME_PROJECT_REF', file: 'a', line: 2 },
            { name: 'REPLACE_ME_PROJECT_REF', file: 'b', line: 1 },
            { name: 'REPLACE_ME_WORKERS_SUBDOMAIN', file: 'b', line: 1 },
        ]);
    });

    test('the refusal says what each placeholder stands for and every place it is', () => {
        const message = report([
            { name: 'REPLACE_ME_HYPERDRIVE_ID', file: 'cloud/web/wrangler.jsonc', line: 3 },
            { name: 'REPLACE_ME_HYPERDRIVE_ID', file: 'cloud/web/wrangler.jsonc', line: 9 },
        ]);
        expect(message).toContain(PLACEHOLDERS.REPLACE_ME_HYPERDRIVE_ID);
        expect(message).toContain('at cloud/web/wrangler.jsonc:3\n');
        expect(message).toContain('at cloud/web/wrangler.jsonc:9\n');
        expect(message).not.toContain('REPLACE_ME_PROJECT_REF');
    });

    test('there is no refusal to write without a placeholder left', () => {
        expect(() => report([])).toThrow(/nothing to report/);
    });

    test('the files it reads exist, so a move of one fails here rather than at deploy', () => {
        for (const file of PRODUCTION_FILES) {
            expect(() => readFileSync(new URL(`../../${file}`, import.meta.url))).not.toThrow();
        }
    });
});
