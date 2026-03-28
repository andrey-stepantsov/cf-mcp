import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json'],
      thresholds: {
        lines: 95,
        statements: 95,
        functions: 95,
        branches: 95
      }
    }
  }
});
