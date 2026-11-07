/**
 * SPDX-License-Identifier: MIT
 */
import { defineProject } from 'vitest/config';

/** This extension's unit tests: its specs, run from the sources, with the setup every IDE spec shares. */
export default defineProject({
    test: {
        include: ['src/**/*.spec.ts'],
        setupFiles: ['@yukibana/ide/configs/vitest.setup.ts'],
    },
});
