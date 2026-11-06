/**
 * SPDX-License-Identifier: MIT
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: { name: 'ci-scripts', environment: 'node', include: ['*.test.mts'] },
});
