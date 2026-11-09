import { test } from 'vitest';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembleSubmission, gzip, readArchive, writeTar, type Entry, type ReleaseRef } from '../src/assembly.js';

const text = (s: string) => new TextEncoder().encode(s);
const file = (path: string, body: string): Entry => ({ path, type: 'file', mode: 0o644, mtime: 1, data: text(body) });
const targz = async (entries: Entry[]) => gzip(await writeTar(entries));
const config = (releaseId?: string) =>
    JSON.stringify({ version: 1, kind: 'scala-sbt', readOnly: ['tests/*', 'yukibana.json'], hidden: ['tests/hidden'], ...(releaseId === undefined ? {} : { releaseId }) });
const NEW: ReleaseRef = { releaseId: '00000000-0000-7000-8000-000000000002', label: 'fixed' };
const OLD: ReleaseRef = { releaseId: '00000000-0000-7000-8000-000000000001', label: '' };
const teacherArchive = (publicTest: string) => [
    file('p/yukibana.json', config()),
    file('p/Main.scala', 'teacher solution'),
    file('p/tests/public.scala', publicTest),
    file('p/tests/hidden/secret.scala', 'secret'),
];
const teachers = new Map([
    [NEW.releaseId, teacherArchive('public test, fixed')],
    [OLD.releaseId, teacherArchive('public test')],
]);
const teacherOf = async (r: ReleaseRef): Promise<Entry[]> => teachers.get(r.releaseId) ?? [];
const sent = (releaseId?: string, publicTest = 'public test') =>
    targz([file('yukibana.json', config(releaseId)), file('Main.scala', 'student solution'), file('tests/public.scala', publicTest)]);
const body = (entries: readonly Entry[], p: string) => new TextDecoder().decode(entries.find(e => e.path === p)?.data);

test('a submission with no recorded release is assembled with the one its own yukibana.json names, as the CLI does', async () => {
    const made = await assembleSubmission(await sent(OLD.releaseId), [NEW, OLD], 'own', null, teacherOf);
    assert.ok(made.ok);
    assert.equal(made.grade, OLD);
    assert.equal(body(made.assembly.entries, 'tests/public.scala'), 'public test');
    assert.equal(body(made.assembly.entries, 'tests/hidden/secret.scala'), 'secret');
    assert.deepEqual(made.assembly.tampering.modified, []);
});

test('with neither a record nor a claim, the newest release grades it', async () => {
    const made = await assembleSubmission(await sent(), [NEW, OLD], 'own', null, teacherOf);
    assert.ok(made.ok);
    assert.equal(made.grade, NEW);
    assert.equal(made.base, null);
});

test('a base release that cannot be fetched is a note, and the changes are measured against the grading release', async () => {
    const failing = async (r: ReleaseRef): Promise<Entry[]> => {
        if (r === OLD) throw new Error('the old teacher archive is gone');
        return teacherOf(r);
    };
    const made = await assembleSubmission(await sent(undefined, 'weakened'), [NEW, OLD], 'newest', OLD.releaseId, failing);
    assert.ok(made.ok);
    assert.deepEqual(made.notes, [`the old teacher archive is gone; what the student changed is measured against fixed (${NEW.releaseId}) instead`]);
    assert.deepEqual(made.assembly.tampering.modified, ['tests/public.scala']);
});

test('an archive that is not a .tar.gz is thrown, like a failed fetch, for the caller to report', async () => {
    await assert.rejects(assembleSubmission(text('not gzip'), [NEW], 'own', null, teacherOf), /not a \.tar\.gz/);
});

test('what is written reads back the same', async () => {
    const entries = [file('a.txt', 'a')];
    assert.deepEqual(
        (await readArchive(await targz(entries))).map(e => e.path),
        ['a.txt'],
    );
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
