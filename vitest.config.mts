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
        projects: ['ide/extensions/*/vitest.config.mts', 'packages/*/vitest.config.ts', 'cloud/web/vitest.config.ts'],
        coverage: {
            provider: 'v8',
            include: ['ide/{common,extensions/*}/src/**/*.{ts,tsx}', 'packages/*/src/**/*.ts', 'cloud/web/src/**/*.ts'],
            exclude: ['**/*.spec.ts', '**/typings/**'],
            reporter: ['text', 'html', 'lcov'],
        },
    },
});
