import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { RELEASABLE, UNRELEASED, compareVersions, decide, outputs, plan, provenanceCommit, type Observed, type Releasable } from './release-plan.mts';

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
    /** Each package at `versions` (else the development version), with `published` out and, unless `tagged` says
     *  otherwise, every version out tagged. */
    const observe = (versions: Record<string, string>, published: Record<string, string[]> = {}, tagged: Record<string, string[]> = {}): Observed[] =>
        RELEASABLE.map(p => ({ package: p, version: versions[p.name] ?? UNRELEASED, published: published[p.name] ?? [], tagged: tagged[p.name] ?? published[p.name] ?? [] }));

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
        const app: Releasable = { name: 'app', manifest: 'app/package.json', registry: 'npm', output: 'app', tagPrefix: 'app-v', needs: [client.name] };
        const p = plan([
            { package: client, version: UNRELEASED, published: [], tagged: [] },
            { package: app, version: '0.1.0', published: [], tagged: [] },
        ]);
        expect(p.refused).toEqual([expect.stringContaining(`${client.name} ${UNRELEASED}`)]);
    });

    test('with one version refused still names it, so the run fails before anything is published', () => {
        const p = plan(observe({ [client.name]: '0.1.0', [ide.name]: '1.0' }));
        expect(p.refused).toHaveLength(1);
    });
});

describe('the tags', () => {
    const observe = (versions: Record<string, string>, published: Record<string, string[]> = {}, tagged: Record<string, string[]> = {}): Observed[] =>
        RELEASABLE.map(p => ({ package: p, version: versions[p.name] ?? UNRELEASED, published: published[p.name] ?? [], tagged: tagged[p.name] ?? published[p.name] ?? [] }));

    test('an npm package released is tagged on the commit released, once published', () => {
        const o = observe({ [cli.name]: '0.2.0' }, { [cli.name]: ['0.1.0'] });
        const p = plan(o);
        expect(p.tags).toEqual([{ package: cli, version: '0.2.0', action: 'here' }]);
        expect(outputs(o, p)).toMatchObject({ 'cli-tag': 'here', 'client-tag': 'none', tags: 'true' });
    });

    test('the IDE gets no npm tag: publishing its GitHub release makes ide-v<version>', () => {
        const o = observe({ [ide.name]: '0.3.0' }, { [ide.name]: ['0.2.0'] });
        const p = plan(o);
        expect(p.tags).toEqual([]);
        expect(outputs(o, p)).toMatchObject({ tags: 'false' });
        expect(outputs(o, p)).not.toHaveProperty('ide-tag');
    });

    test('a version out on npm without its tag is tagged on the commit its provenance names, without releasing it again', () => {
        const o = observe({ [client.name]: '0.1.0' }, { [client.name]: ['0.1.0'] }, { [client.name]: [] });
        const p = plan(o);
        expect(p.release).toEqual([]);
        expect(p.tags).toEqual([{ package: client, version: '0.1.0', action: 'recover' }]);
        expect(outputs(o, p, { [client.name]: 'a'.repeat(40) })).toMatchObject({ 'client-tag': 'recover', 'client-tag-commit': 'a'.repeat(40), tags: 'true', npm: 'false' });
    });

    test('a tag for a version npm does not have is refused, never published under or made again', () => {
        const p = plan(observe({ [cli.name]: '0.2.0' }, { [cli.name]: ['0.1.0'] }, { [cli.name]: ['0.1.0', '0.2.0'] }));
        expect(p.refused).toEqual([expect.stringContaining('cli-v0.2.0')]);
    });

    test('nothing is tagged at the development version, or when the version out is tagged already', () => {
        expect(plan(observe({})).tags).toEqual([]);
        expect(plan(observe({ [cli.name]: '0.1.0' }, { [cli.name]: ['0.1.0'] })).tags).toEqual([]);
    });
});

describe('provenanceCommit', () => {
    const commit = '7a825db43e2beca0b219d2eadaec334cb81af0c7';
    /** The registry's answer for a version's attestations, with one SLSA provenance built from `uri` at `gitCommit`. */
    const answer = (uri: string, gitCommit: string = commit): unknown => ({
        attestations: [
            { predicateType: 'https://github.com/npm/attestation/tree/main/specs/publish/v0.1', bundle: { dsseEnvelope: { payload: 'e30=' } } },
            {
                predicateType: 'https://slsa.dev/provenance/v1',
                bundle: {
                    dsseEnvelope: {
                        payload: Buffer.from(JSON.stringify({ predicate: { buildDefinition: { resolvedDependencies: [{ uri, digest: { gitCommit } }] } } })).toString('base64'),
                    },
                },
            },
        ],
    });

    test('reads the commit a version was built from, in this repository', () => {
        expect(provenanceCommit(answer('git+https://github.com/Yukibana-Ed/Yukibana@refs/heads/main'), 'Yukibana-Ed/Yukibana')).toBe(commit);
    });

    test('ignores a provenance from another repository, or one without a full commit', () => {
        expect(provenanceCommit(answer('git+https://github.com/someone/fork@refs/heads/main'), 'Yukibana-Ed/Yukibana')).toBeUndefined();
        expect(provenanceCommit(answer('git+https://github.com/Yukibana-Ed/YukibanaX@refs/heads/main'), 'Yukibana-Ed/Yukibana')).toBeUndefined();
        expect(provenanceCommit(answer('git+https://github.com/Yukibana-Ed/Yukibana@refs/heads/main', 'abc'), 'Yukibana-Ed/Yukibana')).toBeUndefined();
    });

    test('gives undefined for an answer that is not attestations', () => {
        expect(provenanceCommit({}, 'Yukibana-Ed/Yukibana')).toBeUndefined();
        expect(
            provenanceCommit({ attestations: [{ predicateType: 'https://slsa.dev/provenance/v1', bundle: { dsseEnvelope: { payload: '!!' } } }] }, 'Yukibana-Ed/Yukibana'),
        ).toBeUndefined();
    });
});

test('every releasable manifest exists and names the package, so a rename fails here rather than on main', () => {
    for (const p of RELEASABLE) {
        const manifest: unknown = JSON.parse(readFileSync(new URL(`../../${p.manifest}`, import.meta.url), 'utf8'));
        expect(manifest).toMatchObject({ name: p.name });
    }
});
