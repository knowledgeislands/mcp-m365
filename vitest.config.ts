import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/mcp-server/index.ts', 'src/auth-server/index.ts'],
      // Current coverage baseline. Ratchet upward as tests are added — see
      // ROADMAP.md for the plan to expand coverage of the tool handlers.
      thresholds: {
        lines: 30,
        functions: 30,
        branches: 20,
        statements: 30
      }
    }
  }
})
