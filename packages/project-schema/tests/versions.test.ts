import assert from 'node:assert/strict';
import { test } from 'vitest';
import * as z from 'zod';
import { exact, type Migration } from '../src/exact.js';
import { globsSchema } from '../src/brands.js';
import { NO_PROJECT_FILE } from '../src/project-file.js';
import { projectFileV1, type ProjectFileV1 } from '../src/v1.js';
import { format } from '../src/versions.js';

// A test-only version 2, to run a chain end to end before a real one exists: `hidden` is renamed `secret`, and a
// field is added.
const v2 = projectFileV1
    .omit({ $schema: true, version: true, hidden: true })
    .extend({ $schema: z.literal('https://cloud.yukibana.dev/schema/yukibana/v2.json'), version: z.literal(2), secret: globsSchema, motd: z.string() });
type V2 = z.output<typeof v2>;

const fromV1: Migration<ProjectFileV1, V2> = ({ hidden, ...rest }) =>
    exact<V2>()({ ...rest, $schema: 'https://cloud.yukibana.dev/schema/yukibana/v2.json', version: 2, secret: hidden, motd: '' });

const chain = format('yukibana.json', [projectFileV1, v2], [fromV1]);

test('a file at an older version is read through every step to the latest, and keeps what it was written as', () => {
    const v1 = { ...NO_PROJECT_FILE, hidden: ['tests/hidden'] };
    const read = chain.read(JSON.stringify(v1));
    assert.ok(read.ok);
    assert.equal(read.file.version, 2);
    assert.deepEqual(read.file.secret, ['tests/hidden']);
    assert.ok(!('hidden' in read.file));
    assert.deepEqual(read.written, v1);
});

test('a file at the latest version is not migrated', () => {
    const { hidden, ...rest } = NO_PROJECT_FILE;
    const latest = { ...rest, $schema: 'https://cloud.yukibana.dev/schema/yukibana/v2.json', version: 2, secret: hidden, motd: 'hi' };
    const read = chain.read(JSON.stringify(latest));
    assert.ok(read.ok);
    assert.deepEqual(read.file, latest);
    assert.equal(read.written.version, 2);
});

test('a file is checked at the version it names, not the latest', () => {
    const read = chain.read(JSON.stringify({ ...NO_PROJECT_FILE, motd: 'not in v1' }));
    assert.ok(!read.ok && read.error.kind === 'fields' && read.error.version === 1);
});
