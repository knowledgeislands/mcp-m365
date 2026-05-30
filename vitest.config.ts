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
        'src/tools/*/index.ts',
        // Pure-data annotation presets — no logic to cover.
        'src/utils/annotations.ts'
      ],
      // Thresholds locked at the current achievable floor so future regressions
      // break CI without requiring a full coverage push to 100%. m365 is the
      // outlier of the sibling-MCP family (kb-fs/housekeeping/git-audit/gmail/
      // voicenotes-edit all enforce 100/100/100/100) — see ROADMAP.md for the
      // backlog of test work that would let m365 join them.
      thresholds: {
        lines: 95,
        functions: 97,
        branches: 85,
        statements: 94
      }
    }
  }
})
