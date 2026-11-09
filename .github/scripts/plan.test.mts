/**
 * SPDX-License-Identifier: MIT
 */
import { describe, expect, test } from 'vitest';
import { decide, outputLines } from './plan.mts';

const names = [
    '@yukibana/ci-scripts',
    '@yukibana/cloud-db',
    '@yukibana/cloud-dev',
    '@yukibana/cloud-web',
    '@yukibana/ide',
    '@yukibana/ide-browser',
    '@yukibana/ide-ext',
    '@yukibana/client',
    '@yukibana/cli',
];

describe('what runs', () => {
    test('a run without a base runs everything but a preview', () => {
        expect(decide({ kind: 'unknown', reason: 'a run by hand' }, names)).toEqual({
            packages: names.toSorted(),
            cloud: true,
            ide: true,
            devcontainer: true,
            licenses: true,
            preview: false,
            deploy: true,
        });
    });

    test('a lockfile change checks every package and their licenses, with no preview', () => {
        const plan = decide({ kind: 'shared', affected: [], files: ['pnpm-lock.yaml'] }, names);
        expect(plan).toMatchObject({ packages: names.toSorted(), cloud: true, ide: true, licenses: true, devcontainer: true, preview: false, deploy: true });
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
        expect(decide({ kind: 'packages', affected: ['@yukibana/ci-scripts'], files: ['.github/scripts/licenses.mts'] }, names).licenses).toBe(true);
    });

    test('the packages depending on the fixture repository are checked, and the cloud stack runs when the Worker is among them', () => {
        const affected = ['@yukibana/fixtures', '@yukibana/client', '@yukibana/cli', '@yukibana/cloud-web'];
        const plan = decide({ kind: 'packages', affected, files: ['packages/fixtures/repo.tar.gz'] }, [...names, '@yukibana/fixtures']);
        expect(plan).toMatchObject({ packages: ['@yukibana/cli', '@yukibana/client', '@yukibana/cloud-web', '@yukibana/fixtures'], cloud: true });
    });

    test('a change to CI alone checks every package, and neither previews nor deploys', () => {
        const plan = decide({ kind: 'shared', affected: [], files: ['.github/workflows/ci.yml', 'oxfmt.config.mts'] }, names);
        expect(plan).toMatchObject({ packages: names.toSorted(), cloud: true, devcontainer: false, preview: false, deploy: false });
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

    test('a migration starts the cloud stack and still gets a preview, which runs against the old schema', () => {
        const plan = decide(
            { kind: 'packages', affected: ['@yukibana/cloud-db', '@yukibana/cloud-web'], files: ['cloud/db/supabase/migrations/1_x.sql', 'cloud/web/src/a.ts'] },
            names,
        );
        expect(plan).toMatchObject({ cloud: true, preview: true });
    });

    test('a change to the Worker alone may have a preview, and deploys', () => {
        expect(decide({ kind: 'packages', affected: ['@yukibana/cloud-web'], files: ['cloud/web/src/a.ts'] }, names)).toMatchObject({
            cloud: true,
            preview: true,
            deploy: true,
        });
    });

    test('a change to the devcontainer or the scripts its start runs builds it', () => {
        expect(decide({ kind: 'packages', affected: ['@yukibana/cloud-dev'], files: ['cloud/dev/.devcontainer/setup.sh'] }, names).devcontainer).toBe(true);
        expect(decide({ kind: 'packages', affected: ['@yukibana/cloud-dev'], files: ['cloud/dev/scripts/smoke.mjs'] }, names).devcontainer).toBe(true);
    });

    test("a change to the cloud's local scripts runs the cloud stack, which runs them, and neither the IDE's tests nor a deploy", () => {
        const plan = decide({ kind: 'packages', affected: ['@yukibana/cloud-dev'], files: ['cloud/dev/scripts/smoke.mjs'] }, names);
        expect(plan).toEqual({ packages: ['@yukibana/cloud-dev'], cloud: true, ide: false, devcontainer: true, licenses: false, preview: false, deploy: false });
    });

    test("a change to CI's scripts checks them alone", () => {
        const plan = decide({ kind: 'packages', affected: ['@yukibana/ci-scripts'], files: ['.github/scripts/plan.mts'] }, names);
        expect(plan).toEqual({ packages: ['@yukibana/ci-scripts'], cloud: false, ide: false, devcontainer: false, licenses: false, preview: false, deploy: false });
    });

    test('a change to the Supabase stack the devcontainer starts, or to a manifest its install reads, builds it', () => {
        expect(decide({ kind: 'packages', affected: ['@yukibana/cloud-db'], files: ['cloud/db/supabase/config.toml'] }, names).devcontainer).toBe(true);
        expect(decide({ kind: 'packages', affected: ['@yukibana/cloud-web'], files: ['cloud/web/package.json'] }, names).devcontainer).toBe(true);
        expect(decide({ kind: 'packages', affected: ['@yukibana/cloud-db'], files: ['cloud/db/supabase/migrations/1_a.sql'] }, names).devcontainer).toBe(false);
    });

    test('a change to the placeholder check the deploy runs deploys', () => {
        expect(decide({ kind: 'packages', affected: ['@yukibana/ci-scripts'], files: ['.github/scripts/production-config.mts'] }, names).deploy).toBe(true);
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
