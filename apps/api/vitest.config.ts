import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals:     true,
    environment: 'node',
    include:     ['src/__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include:  ['src/**/*.ts'],
      exclude:  ['src/__tests__/**'],
    },
    // 30s timeout for each test (API calls can be slow in CI)
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
