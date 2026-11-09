import { test } from 'vitest';
import assert from 'node:assert/strict';
import { KINDS as CLIENT_KINDS } from '@yukibana/client/config';
import { KINDS } from '../src/lib/kinds.js';

test('a teacher can create a project of exactly the kinds a yukibana.json may name', () => {
    // The form offers this list; the CLI's build and the IDE accept the client's. A kind on one side only is a project
    // nobody can build, or a build system nobody can choose.
    assert.deepEqual(KINDS, CLIENT_KINDS);
});
