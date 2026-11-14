import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { test } from 'vitest';

test('the package runs in a browser: nothing in src/ imports from Node, and only zod from outside', async () => {
    const dir = new URL('../src/', import.meta.url);
    for (const name of await readdir(dir)) {
        const source = await readFile(new URL(name, dir), 'utf8');
        const imports = [...source.matchAll(/^(?:import|export) .* from '([^']+)';/gm)].map(m => m[1] ?? '');
        assert.deepEqual(
            imports.filter(i => i !== 'zod' && !i.startsWith('./')),
            [],
            `src/${name} imports only zod and the package's own modules`,
        );
    }
});
