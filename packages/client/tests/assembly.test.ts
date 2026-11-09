import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembleInto, gzip, writeTar, type Entry } from '../src/assembly.js';

const text = (s: string) => new TextEncoder().encode(s);
const file = (path: string, body: string): Entry => ({ path, type: 'file', mode: 0o644, mtime: 1, data: text(body) });
const targz = async (entries: Entry[]) => gzip(await writeTar(entries));
const CONFIG = '{"version":1,"kind":"scala-sbt","readOnly":["tests/*","yukibana.json"],"hidden":["tests/hidden"]}';
const teacher = () =>
    targz([
        { path: 'p', type: 'dir', mode: 0o755, mtime: 1, data: new Uint8Array(0) },
        file('p/yukibana.json', CONFIG),
        file('p/Main.scala', 'teacher solution'),
        file('p/tests/public.scala', 'public test'),
        file('p/tests/hidden/secret.scala', 'secret test'),
    ]);

test('a submission and a teacher archive become one project to grade, in its own folder, with the hidden tests in it', async () => {
    const submission = await targz([file('yukibana.json', CONFIG), file('Main.scala', 'student solution'), file('tests/public.scala', 'weakened test')]);
    const made = await assembleInto('all/alice', submission, await teacher());
    assert.ok(made.ok);
    const body = (p: string) => new TextDecoder().decode(made.entries.find(e => e.path === `all/alice/${p}`)?.data);
    assert.equal(body('Main.scala'), 'student solution');
    assert.equal(body('tests/public.scala'), 'public test');
    assert.equal(body('tests/hidden/secret.scala'), 'secret test');
    assert.deepEqual(made.assembled.assembly.tampering.modified, ['tests/public.scala']);
});

test('an archive that is not one is a problem that names it, not a throw', async () => {
    const made = await assembleInto('alice', text('not gzip'), await teacher());
    assert.deepEqual(made, { ok: false, problem: 'the submission could not be read (not a .tar.gz)' });
});

test('the browser entry reaches no Node module, however deep its imports go', () => {
    const src = resolve(dirname(fileURLToPath(import.meta.url)), '../src');
    const seen = new Set<string>();
    const visit = (path: string): void => {
        if (seen.has(path)) return;
        seen.add(path);
        for (const [, spec] of readFileSync(path, 'utf8').matchAll(/^(?:import|export)[^'"]*from '([^']+)'/gm)) {
            if (spec === undefined) continue;
            assert.ok(!spec.startsWith('node:'), `${path.slice(src.length)} imports ${spec}`);
            if (spec.startsWith('.')) visit(join(dirname(path), spec.replace(/\.js$/, '.ts')));
        }
    };
    visit(join(src, 'assembly.ts'));
    assert.ok(seen.size > 3);
});
