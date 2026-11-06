/**
 * SPDX-License-Identifier: MIT
 */
import { defineConfig } from 'vitest/config';

/** The unit tests: every spec of the extensions and their libraries, run from the sources. */
export default defineConfig({
    test: {
        include: ['{packages,theia-extensions}/*/src/**/*.spec.ts'],
        setupFiles: ['./configs/vitest.setup.ts'],
        coverage: {
            provider: 'v8',
            include: ['{packages,theia-extensions}/*/src/**/*.{ts,tsx}'],
            // packages/cli: imported from yukibana-cloud, tested with its own config until it joins the workspace.
            exclude: ['**/*.spec.ts', '**/typings/**', 'packages/cli/**'],
            reporter: ['text', 'html', 'lcov'],
        },
    },
});
