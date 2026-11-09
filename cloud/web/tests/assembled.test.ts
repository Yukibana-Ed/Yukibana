import { test, expect } from 'vitest';
import { assemblyFolder, findings, type AssemblyReport } from '../src/lib/hand-ins/assembled';

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

test('an assembly unpacks into a folder named like the plain download, safe on every file system', () => {
    expect(assemblyFolder('warmup', 'alice', new Date('2026-11-07T00:57:30.123Z'))).toBe('warmup-alice-2026-11-07T00-57-30-123Z');
    expect(assemblyFolder('warmup', null, new Date('2026-11-07T00:57:00Z'))).toBe('warmup-student-2026-11-07T00-57-00-000Z');
});
