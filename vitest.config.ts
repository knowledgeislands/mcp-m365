import * as os from 'node:os'
import * as path from 'node:path'
import { defineConfig } from 'vitest/config'

const TEST_ROOT = path.join(os.tmpdir(), 'knowledgeislands-tests')

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    fileParallelism: false,
    env: {
      ROOT_PATH: TEST_ROOT
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        // Server entry points and tool registration aggregators are pure
        // wiring (every line is `server.registerTool(...)`); their behaviour
        // is exercised by `npm run inspect` and the smoke test in CI.
        'src/mcp-server/index.ts',
        'src/auth-server/**',
        'src/tools/index.ts',
        'src/tools/*/index.ts'
      ],
      thresholds: {
        lines: 95,
        functions: 95,
        branches: 80,
        statements: 90
      }
    }
  }
})
