import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { RELEASABLE, UNRELEASED, compareVersions, decide, outputs, plan, type Observed, type Releasable } from './release-plan.mts';

function pkg(name: string): Releasable {
    const found = RELEASABLE.find(p => p.name === name);
    if (found === undefined) {
        throw new Error(`no releasable ${name}`);
    }
    return found;
}

const client = pkg('@yukibana/client');
const cli = pkg('@yukibana/cli');
const ide = pkg('@yukibana/ide-electron');

describe('one package’s version', () => {
    test('the development version in git is never released, and is not a fault', () => {
        expect(decide('a', UNRELEASED, [])).toEqual({ kind: 'skip', reason: expect.stringContaining(UNRELEASED) });
    });

    test('a version that is out already is not released again', () => {
        expect(decide('a', '1.2.3', ['1.2.2', '1.2.3']).kind).toBe('skip');
    });

    test('a version nobody released yet is released, the first one included', () => {
        expect(decide('a', '0.1.0', [])).toEqual({ kind: 'release' });
        expect(decide('a', '1.10.0', ['1.9.9', '0.0.0-dev'])).toEqual({ kind: 'release' });
    });

    test('a version lower than the newest one out is refused with a sentence that names both', () => {
        const d = decide('a', '1.2.0', ['1.3.0']);
        expect(d.kind).toBe('refuse');
        expect(d.kind === 'refuse' && d.reason).toMatch(/1\.2\.0.*1\.3\.0/);
    });

    test.each(['1.2', 'v1.2.3', '1.2.3-beta.1', '01.2.3', '1.2.3+build'])('%s is refused: only X.Y.Z or the development version may be on main', v => {
        expect(decide('a', v, []).kind).toBe('refuse');
    });

    test('versions compare by number, not by text', () => {
        expect(compareVersions('1.10.0', '1.9.0')).toBeGreaterThan(0);
        expect(compareVersions('2.0.0', '2.0.0')).toBe(0);
        expect(() => compareVersions('1.0', '1.0.0')).toThrow(/not X\.Y\.Z/);
    });
});

describe('a push to main', () => {
    const observe = (versions: Record<string, string>, published: Record<string, string[]> = {}): Observed[] =>
        RELEASABLE.map(p => ({ package: p, version: versions[p.name] ?? UNRELEASED, published: published[p.name] ?? [] }));

    test('with every version at the development version releases nothing', () => {
        const o = observe({});
        const p = plan(o);
        expect(p.release).toEqual([]);
        expect(p.refused).toEqual([]);
        expect(outputs(o, p)).toMatchObject({ client: 'false', cli: 'false', ide: 'false', npm: 'false' });
    });

    test('that bumps the IDE alone releases the IDE alone', () => {
        const o = observe({ [ide.name]: '0.2.0' }, { [ide.name]: ['0.1.0'] });
        const p = plan(o);
        expect(p.release).toEqual([{ package: ide, version: '0.2.0' }]);
        expect(outputs(o, p)).toMatchObject({ ide: 'true', 'ide-version': '0.2.0', npm: 'false' });
    });

    test('that bumps the client and the CLI releases the client before the CLI', () => {
        const p = plan(observe({ [client.name]: '0.1.0', [cli.name]: '0.1.0' }));
        expect(p.release.map(r => r.package.name)).toEqual([client.name, cli.name]);
        expect(p.refused).toEqual([]);
    });

    test('that bumps the CLI over a client already out releases the CLI', () => {
        const p = plan(observe({ [client.name]: '0.1.0', [cli.name]: '0.1.1' }, { [client.name]: ['0.1.0'], [cli.name]: ['0.1.0'] }));
        expect(p.release.map(r => r.package.name)).toEqual([cli.name]);
        expect(p.refused).toEqual([]);
    });

    test('that bumps the CLI alone releases it, because it bundles the client rather than depending on it', () => {
        const p = plan(observe({ [cli.name]: '0.1.0' }));
        expect(p.release.map(r => r.package.name)).toEqual([cli.name]);
        expect(p.refused).toEqual([]);
    });

    test('that bumps a package over a workspace package it needs and nobody can install is refused, naming that package', () => {
        const app: Releasable = { name: 'app', manifest: 'app/package.json', registry: 'npm', output: 'app', needs: [client.name] };
        const p = plan([
            { package: client, version: UNRELEASED, published: [] },
            { package: app, version: '0.1.0', published: [] },
        ]);
        expect(p.refused).toEqual([expect.stringContaining(`${client.name} ${UNRELEASED}`)]);
    });

    test('with one version refused still names it, so the run fails before anything is published', () => {
        const p = plan(observe({ [client.name]: '0.1.0', [ide.name]: '1.0' }));
        expect(p.refused).toHaveLength(1);
    });
});

test('every releasable manifest exists and names the package, so a rename fails here rather than on main', () => {
    for (const p of RELEASABLE) {
        const manifest: unknown = JSON.parse(readFileSync(new URL(`../../${p.manifest}`, import.meta.url), 'utf8'));
        expect(manifest).toMatchObject({ name: p.name });
    }
});
