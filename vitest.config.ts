import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/api/**/*.test.ts'],
    testTimeout: 30000,
    // Each test file gets a fresh module registry (isolate) so a per-file
    // DATA_DIR tmp dir never leaks into another file's DB.
    isolate: true,
  },
});
