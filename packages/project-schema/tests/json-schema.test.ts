import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { expect, test } from 'vitest';
import { SCHEMA_URL, schemaFiles } from '../src/index.js';

test('every version has its JSON Schema in schemas/, generated from the zod schema it was read with', async () => {
    // `pnpm --filter @yukibana/project-schema schemas` writes the unreleased files (vitest --update). A released
    // version's file is compared and never written, so it stays what the files naming it were checked against.
    for (const file of schemaFiles()) {
        const at = new URL(`../schemas/${file.path}`, import.meta.url);
        if (file.released) assert.equal(await readFile(at, 'utf8'), file.text, `released ${file.path} must not change`);
        else await expect(file.text).toMatchFileSnapshot(at.pathname);
    }
});

test('schemas/ holds nothing the package does not generate', async () => {
    const generated = new Set(schemaFiles().map(f => f.path));
    for (const format of await readdir(new URL('../schemas/', import.meta.url)))
        for (const name of await readdir(new URL(`../schemas/${format}/`, import.meta.url))) assert.ok(generated.has(`${format}/${name}`), `schemas/${format}/${name}`);
});

test("a version's JSON Schema lives at the URL a file of that version names as $schema", () => {
    const v1 = schemaFiles().find(f => f.format === 'yukibana' && f.version === 1);
    assert.ok(v1);
    const schema = JSON.parse(v1.text) as Record<string, unknown>;
    assert.equal(schema['$id'], SCHEMA_URL);
    assert.equal(schema['additionalProperties'], false);
    assert.deepEqual(new Set(schema['required'] as string[]), new Set(Object.keys(schema['properties'] as object)));
});
