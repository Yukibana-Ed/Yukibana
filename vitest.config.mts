/**
 * SPDX-License-Identifier: MIT
 */
import { defineConfig } from 'vitest/config';

/**
 * Every package's unit tests in one run, each with its package's own config: `pnpm test` here is the same as
 * `pnpm -r test`, with one coverage report over the sources they cover.
 */
export default defineConfig({
    test: {
        // Every package's config, in the directories pnpm-workspace.yaml takes packages from, so that a package's new tests
        // run here without an entry; and the CI workflows' scripts, which belong to no package. Not `**`: ide/plugins holds
        // downloaded extensions, which may ship a Vitest config of their own.
        projects: ['{cloud/*,ide,ide/*,ide/extensions/*,ide/extensions/langs/*,packages/*}/vitest.config.{ts,mts}', '.github/scripts/vitest.config.mts'],
        coverage: {
            provider: 'v8',
            // Relative to each project's root.
            include: ['**/src/**/*.{ts,tsx}'],
            exclude: ['**/*.spec.ts', '**/typings/**'],
            reporter: ['text', 'html', 'lcov'],
        },
    },
});
