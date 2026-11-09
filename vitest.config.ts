import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['tests/**/*.test.ts', 'ui/tests/**/*.test.ts'],
          exclude: ['tests/e2e/**', '**/node_modules/**'],
          environment: 'node',
          testTimeout: 20_000,
        },
      },
      {
        test: {
          name: 'e2e',
          include: ['tests/e2e/**/*.e2e.test.ts'],
          globalSetup: ['tests/e2e/global-setup.ts'],
          environment: 'node',
          testTimeout: 60_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
