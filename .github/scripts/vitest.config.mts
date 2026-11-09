/**
 * SPDX-License-Identifier: MIT
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: { name: '@yukibana/ci-scripts', environment: 'node', include: ['*.test.mts'] },
});
