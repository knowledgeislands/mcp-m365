import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'html'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        // Server entry points and tool registration aggregators are pure
        // wiring (every line is `server.registerTool(...)`); their behaviour
        // is exercised by `bun run server:mcp:inspect` and the smoke test in CI.
        'src/mcp-server/index.ts',
        'src/auth-server/**',
        'src/tools/index.ts',
        'src/tools/**/index.ts',
        // Pure-data annotation presets — no logic to cover.
        'src/utils/annotations.ts'
      ],
      // All four metrics enforced at 100%, matching the rest of the sibling-MCP
      // family (kb-fs / housekeeping / git-audit / gmail / voicenotes-edit). The
      // real implementation now lives in `main/`; only the wiring-only entry
      // points and pure-data modules above are excluded.
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100
      }
    }
  }
})
