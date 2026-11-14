import assert from 'node:assert/strict';
import { test } from 'vitest';
import { describe, LATEST, NO_PROJECT_FILE, parseProjectFile, parseReleaseFile, SCHEMA_URL, type ReadError } from '../src/index.js';

/** A complete, valid version 1 file, as `config init` will write one, changed by `edit`. */
function file(edit: (f: Record<string, unknown>) => void = () => {}): string {
    const f = structuredClone(NO_PROJECT_FILE) as unknown as Record<string, unknown>;
    edit(f);
    return JSON.stringify(f);
}

/** The error reading `text` gives; fails the test if it reads. */
function errorOf(text: string): ReadError {
    const read = parseProjectFile(text);
    assert.ok(!read.ok, 'expected the file to be refused');
    return read.error;
}

const sentence = (text: string): string => describe('yukibana.json', errorOf(text));

test('a complete version 1 file reads as itself, at version 1', () => {
    const read = parseProjectFile(file());
    assert.ok(read.ok);
    assert.deepEqual(read.file, NO_PROJECT_FILE);
    assert.equal(read.written.version, 1);
    assert.equal(LATEST, 1);
});

test('a misspelt field is refused, naming it, instead of being passed through', () => {
    assert.match(
        sentence(
            file(f => {
                f['hiden'] = ['tests'];
            }),
        ),
        /"hiden"|hiden/,
    );
});

test('a misspelt field deep in the file is refused too', () => {
    assert.match(
        sentence(
            file(f => {
                (f['layout'] as Record<string, Record<string, unknown>>)['widgets']!['explorer'] = false;
            }),
        ),
        /layout\.widgets.*explorer/,
    );
});

test('every field is required, and each missing one is named', () => {
    for (const field of Object.keys(NO_PROJECT_FILE).filter(k => k !== 'version')) {
        const error = errorOf(
            file(f => {
                delete f[field];
            }),
        );
        assert.equal(error.kind, 'fields');
        assert.ok(error.kind === 'fields' && error.issues.some(i => i.field === field), `${field} should be named`);
    }
});

test('a file at a newer version says it needs a newer program, with both numbers', () => {
    const error = errorOf(
        file(f => {
            f['version'] = 2;
        }),
    );
    assert.deepEqual(error, { kind: 'newer', version: 2, latest: 1 });
    assert.equal(describe('yukibana.json', error), 'This project needs yukibana.json v2; this program reads up to v1');
});

test('a file without a version names the field', () => {
    const error = errorOf(
        file(f => {
            delete f['version'];
        }),
    );
    assert.equal(error.kind, 'no-version');
    assert.match(describe('yukibana.json', error), /"version" is missing/);
});

test('a version that never existed is not mistaken for an old one', () => {
    for (const version of [0, -1, 1.5, '1', null]) {
        const error = errorOf(
            file(f => {
                f['version'] = version;
            }),
        );
        assert.deepEqual(error, { kind: 'unknown-version', version });
    }
});

test('a $schema that names another version than the file is refused', () => {
    assert.match(
        sentence(
            file(f => {
                f['$schema'] = SCHEMA_URL.replace('v1', 'v2');
            }),
        ),
        /"\$schema" must be https:\/\/yukibana\.dev\/schema\/yukibana\/v1\.json/,
    );
});

test('a glob that reaches outside the project is refused', () => {
    for (const glob of ['/abs', '../up', 'a/../../b', '']) {
        assert.match(
            sentence(
                file(f => {
                    f['hidden'] = [glob];
                }),
            ),
            /"hidden"/,
            glob,
        );
    }
});

test('a submission target other than cloud or file is refused', () => {
    assert.match(
        sentence(
            file(f => {
                (f['submission'] as Record<string, unknown>)['target'] = 'email';
            }),
        ),
        /"submission\.target" must be one of cloud, file/,
    );
});

test('three mistakes give three sentences, so a teacher fixes them in one run', () => {
    const error = errorOf(
        file(f => {
            f['hiden'] = [];
            f['kind'] = 'cobol';
            (f['features'] as Record<string, unknown>)['ai'] = 'no';
        }),
    );
    assert.ok(error.kind === 'fields');
    assert.equal(error.issues.length, 3);
    assert.equal(describe('yukibana.json', error).split('; ').length, 3);
});

test('text that is not a JSON object is refused before any version is looked at', () => {
    assert.equal(errorOf('{').kind, 'not-json');
    assert.equal(errorOf('[]').kind, 'not-object');
    assert.equal(errorOf('null').kind, 'not-object');
});

test('the files a course repository used to carry, with projectId and releaseId, are refused', () => {
    assert.match(
        sentence(
            file(f => {
                f['projectId'] = '019a0000-0000-7000-8000-000000000000';
            }),
        ),
        /projectId/,
    );
});

test('a release file holds exactly a project id and a release id', () => {
    const ids = { projectId: '019a0000-0000-7000-8000-000000000000', releaseId: '3f2c0000-0000-4000-8000-000000000000' };
    const read = parseReleaseFile(JSON.stringify({ version: 1, ...ids }));
    assert.ok(read.ok);
    assert.deepEqual(read.file, { version: 1, ...ids });
    const extra = parseReleaseFile(JSON.stringify({ version: 1, ...ids, hidden: [] }));
    assert.ok(!extra.ok && extra.error.kind === 'fields');
    const notV7 = parseReleaseFile(JSON.stringify({ version: 1, ...ids, projectId: ids.releaseId }));
    assert.ok(!notV7.ok && notV7.error.kind === 'fields' && notV7.error.issues[0].field === 'projectId');
});
