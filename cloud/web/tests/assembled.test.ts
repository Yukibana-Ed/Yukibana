import { test, expect } from 'vitest';
import { findings, type AssemblyReport } from '../src/lib/hand-ins/assembled';

const nothing: AssemblyReport = { tampering: { modified: [], deleted: [], added: [] }, unrestored: [], overridden: [], refused: [] };

test('an assembly where the student touched nothing protected says nothing', () => {
    expect(findings(nothing)).toEqual([]);
});

test('an assembly says what it restored, what it dropped and what it had to keep', () => {
    const report: AssemblyReport = {
        tampering: { modified: ['tests/a.rs', 'tests/old.rs'], deleted: ['tests/b.rs'], added: ['tests/hidden/mine.rs'] },
        unrestored: ['tests/old.rs'],
        overridden: ['src/lib.rs'],
        refused: ['link'],
    };
    expect(findings(report)).toEqual([
        'Restored tests/a.rs, tests/b.rs',
        'Removed tests/hidden/mine.rs',
        "Kept the student's tests/old.rs (no longer protected)",
        "Replaced src/lib.rs with the release's",
        'Removed symlinks link',
    ]);
});

test('what the release choice noted follows what the assembly changed', () => {
    const report: AssemblyReport = { ...nothing, tampering: { modified: ['tests/a.rs'], deleted: [], added: [] } };
    expect(findings(report, ['its yukibana.json names release x, which is not a release of this project'])).toEqual([
        'Restored tests/a.rs',
        'its yukibana.json names release x, which is not a release of this project',
    ]);
});
