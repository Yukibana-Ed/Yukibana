/**
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, test } from 'vitest';
import { affectedSelectors, decide, outputLines, type WorkspacePackage } from './plan.mts';

const workspace: WorkspacePackage[] = [
    { name: undefined, dir: '' },
    { name: '@yukibana/cloud-db', dir: 'cloud/db' },
    { name: '@yukibana/cloud-web', dir: 'cloud/web' },
    { name: '@yukibana/ide', dir: 'ide' },
    { name: '@yukibana/ide-browser', dir: 'ide/browser' },
    { name: '@yukibana/ide-ext', dir: 'ide/extensions/yukibana' },
    { name: '@yukibana/client', dir: 'packages/client' },
    { name: '@yukibana/cli', dir: 'packages/cli' },
];
const names = workspace.flatMap(p => (p.name === undefined ? [] : [p.name]));
const packageAt = (dir: string): WorkspacePackage => workspace.find(p => p.dir === dir) ?? { name: 'missing', dir };

describe('which packages are affected', () => {
    test('a change to a package selects it and what depends on it', () => {
        expect(affectedSelectors('abc', [packageAt('packages/client')], workspace)).toEqual(['...[abc]']);
    });

    test("a change to the IDE's own package selects every package under ide/, which are built with its configs", () => {
        expect(affectedSelectors('abc', [packageAt('ide'), packageAt('packages/cli')], workspace)).toEqual(['...[abc]', '...{ide/**}']);
    });

    test('a package whose name only starts like a directory is not under it', () => {
        const lookalike = [...workspace, { name: '@yukibana/cloud-web-tools', dir: 'cloud/web-tools' }];
        expect(affectedSelectors('abc', [packageAt('cloud/web')], lookalike)).toEqual(['...[abc]']);
    });

    test('the workspace root is never a package to select from: a change there is everything', () => {
        expect(() => affectedSelectors('abc', [packageAt('')], workspace)).toThrow(/every package/);
    });
});

describe('what runs', () => {
    test('a run without a base runs everything but a preview', () => {
        expect(decide({ kind: 'unknown', reason: 'a run by hand' }, names)).toEqual({
            packages: [...names].sort(),
            cloud: true,
            ide: true,
            devcontainer: true,
            licenses: true,
            preview: false,
            deploy: true,
        });
    });

    test('a lockfile change checks every package and their licenses', () => {
        const plan = decide({ kind: 'shared', affected: [], files: ['pnpm-lock.yaml'] }, names);
        expect(plan).toMatchObject({ packages: [...names].sort(), cloud: true, ide: true, licenses: true, devcontainer: true, preview: true, deploy: true });
    });

    test('a change to the CLI alone starts neither the cloud stack nor the IDE end-to-end tests', () => {
        const plan = decide({ kind: 'packages', affected: ['@yukibana/cli'], files: ['packages/cli/src/index.ts'] }, names);
        expect(plan).toEqual({ packages: ['@yukibana/cli'], cloud: false, ide: false, devcontainer: false, licenses: false, preview: false, deploy: false });
    });

    test("a change to the client library tests the IDE that uses it, and not the cloud, which doesn't", () => {
        const affected = ['@yukibana/client', '@yukibana/ide-ext', '@yukibana/ide-browser', '@yukibana/cli'];
        const plan = decide({ kind: 'packages', affected, files: ['packages/client/src/library.ts'] }, names);
        expect(plan).toMatchObject({ packages: ['@yukibana/cli', '@yukibana/client', '@yukibana/ide-browser', '@yukibana/ide-ext'], cloud: false, ide: true });
    });

    test('a change to the license rules checks the licenses', () => {
        expect(decide({ kind: 'shared', affected: [], files: ['.github/scripts/licenses.mts'] }, names).licenses).toBe(true);
    });

    test('a change to the fixture repository alone has the built CLI and the cloud stack check it, and deploys nothing', () => {
        const plan = decide({ kind: 'packages', affected: ['@yukibana/client'], files: ['packages/client/tests/fixtures/repo.tar.gz'] }, names);
        expect(plan).toMatchObject({ packages: ['@yukibana/cli', '@yukibana/client'], cloud: true, deploy: false });
    });

    test('a change to CI alone checks every package and deploys nothing', () => {
        const plan = decide({ kind: 'shared', affected: [], files: ['.github/workflows/ci.yml', 'oxfmt.config.mts'] }, names);
        expect(plan).toMatchObject({ packages: [...names].sort(), cloud: true, devcontainer: false, deploy: false });
    });

    test('a change to CI together with the Worker deploys', () => {
        const plan = decide({ kind: 'shared', affected: ['@yukibana/cloud-web'], files: ['.github/workflows/ci.yml', 'cloud/web/src/a.ts'] }, names);
        expect(plan.deploy).toBe(true);
    });

    test('a change to the deploy itself deploys', () => {
        expect(decide({ kind: 'shared', affected: [], files: ['.github/workflows/deploy-cloud.yml'] }, names).deploy).toBe(true);
    });

    test("a change to the IDE's build scripts runs the end-to-end tests", () => {
        expect(decide({ kind: 'packages', affected: ['@yukibana/ide'], files: ['ide/scripts/cli.mts'] }, names).ide).toBe(true);
    });

    test('a migration starts the cloud stack and rules out a preview, which would run against the old schema', () => {
        const plan = decide(
            { kind: 'packages', affected: ['@yukibana/cloud-db', '@yukibana/cloud-web'], files: ['cloud/db/supabase/migrations/1_x.sql', 'cloud/web/src/a.ts'] },
            names,
        );
        expect(plan).toMatchObject({ cloud: true, preview: false });
    });

    test('a change to the Worker alone may have a preview, and deploys', () => {
        expect(decide({ kind: 'packages', affected: ['@yukibana/cloud-web'], files: ['cloud/web/src/a.ts'] }, names)).toMatchObject({
            cloud: true,
            preview: true,
            deploy: true,
        });
    });

    test('a change to the devcontainer or the scripts its start runs builds it', () => {
        expect(decide({ kind: 'shared', affected: [], files: ['cloud/dev/.devcontainer/setup.sh'] }, names).devcontainer).toBe(true);
        expect(decide({ kind: 'shared', affected: [], files: ['cloud/dev/scripts/smoke.mjs'] }, names).devcontainer).toBe(true);
    });

    test('a change to the Supabase stack the devcontainer starts, or to a manifest its install reads, builds it', () => {
        expect(decide({ kind: 'packages', affected: ['@yukibana/cloud-db'], files: ['cloud/db/supabase/config.toml'] }, names).devcontainer).toBe(true);
        expect(decide({ kind: 'packages', affected: ['@yukibana/cloud-web'], files: ['cloud/web/package.json'] }, names).devcontainer).toBe(true);
        expect(decide({ kind: 'packages', affected: ['@yukibana/cloud-db'], files: ['cloud/db/supabase/migrations/1_a.sql'] }, names).devcontainer).toBe(false);
    });

    test('a change to the placeholder check the deploy runs deploys', () => {
        expect(decide({ kind: 'shared', affected: [], files: ['.github/scripts/production-config.mts'] }, names).deploy).toBe(true);
    });

    test("a change to the IDE's plugin list checks the plugins' licenses", () => {
        expect(decide({ kind: 'packages', affected: ['@yukibana/ide'], files: ['ide/package.json'] }, names).licenses).toBe(true);
    });

    test('a change that affects no package runs no package job', () => {
        expect(decide({ kind: 'packages', affected: [], files: ['README.md'] }, names)).toEqual({
            packages: [],
            cloud: false,
            ide: false,
            devcontainer: false,
            licenses: false,
            preview: false,
            deploy: false,
        });
    });

    test('an affected package outside the workspace is a bug in the plan, not an empty run', () => {
        expect(() => decide({ kind: 'packages', affected: ['@yukibana/gone'], files: [] }, names)).toThrow(/@yukibana\/gone/);
    });
});

test('the plan reaches the workflow as one output per line, the packages as JSON', () => {
    const lines = outputLines({ packages: ['@yukibana/cli'], cloud: false, ide: true, devcontainer: false, licenses: false, preview: false, deploy: false });
    expect(lines).toBe('packages=["@yukibana/cli"]\ncloud=false\nide=true\ndevcontainer=false\nlicenses=false\npreview=false\ndeploy=false\n');
});
