# Contributing

Thanks for your interest. This file covers the dev loop, conventions, and what to check before you open a PR.

## Setup

You'll need [Bun](https://bun.sh) 1.3+ for the dev loop, and Node.js 22+ to run the compiled `dist/` output the published package ships.

```bash
git clone https://github.com/knowledgeislands/mcp-m365.git
cd mcp-m365
bun install
```

`bun install` triggers `prepare` which configures the husky pre-commit hook — so every commit will auto-run `lint-staged` and format your changes.

## Dev loop

```bash
bun run server:mcp:dev      # bun --watch — runs the MCP server from source
bun run server:auth:dev     # bun --watch — runs the OAuth server from source
bun run server:mcp:inspect  # MCP Inspector against the TS source
bun run lint:types          # tsc --noEmit
bun run test                # vitest (use `bun run test`, not `bun test`)
bun run test:watch          # vitest in watch mode
bun run test:coverage       # vitest with v8 coverage report
bun run lint:check          # Biome lint + format check
bun run lint:fix            # Biome auto-fix
bun run lint:md             # prettier + markdownlint for *.md
```

## Conventions

### Code

- **TypeScript ES modules** — `"type": "module"`, internal imports use `.js` extensions (e.g. `from './tools/calendar/list.js'`) so `tsc` emits valid JS.
- **Arrow functions** for top-level declarations (`export const foo = () => …`).
- **Config injection, no env at import**: env is read only inside `loadConfig(env?)` in `src/config/index.ts`. Nothing reads `process.env` at module load. Entry points (`src/mcp-server/index.ts`, `src/auth-server/index.ts`) call `loadConfig()` once and thread the `Config` (or a slice) into the access gate, `initTokenStorage(config)`, and tool registration. `src/utils/*` helpers take the config primitive/slice they need (`makeAccessGatedRegister(server, accessLevel, audit)`, `withAuditLog(auditConfig, …)`), never the global env.
- **OneDrive path safety**: any caller-supplied OneDrive path interpolated into a Graph endpoint must go through `sanitizeOneDrivePath()` from `src/utils/odata-helpers.ts` (rejects `:`/`\`/`.`/`..`/empty segments, `encodeURIComponent`s the rest).
- **Errors**: tools surface Graph errors via `errorResult(action, err)` (so the 401 auth hint is appended by `errMessage()` in `src/utils/errors.ts`).
- **Annotations**: be honest with `readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint` on every tool registration — the access gate derives each tool's level from them.

### Commits

This repo uses [Conventional Commits](https://www.conventionalcommits.org/) so version bumps are easy to derive when releasing by hand. There is no auto-release pipeline.

| Type        | What it means           | Bumps |
| ----------- | ----------------------- | ----- |
| `feat:`     | new feature             | minor |
| `fix:`      | bug fix                 | patch |
| `perf:`     | performance improvement | patch |
| `docs:`     | documentation only      | patch |
| `deps:`     | dependency change       | patch |
| `refactor:` | internal restructuring  | none  |
| `test:`     | test-only changes       | none  |
| `chore:`    | tooling, config         | none  |
| `build:`    | build pipeline          | none  |
| `ci:`       | CI changes              | none  |

Add `!` for breaking changes (`feat!:` / `fix!:`) — bumps major.

### Testing

- New code should ship with tests. Vitest is configured with V8 coverage and has thresholds in `vitest.config.ts` — if your change drops coverage below the threshold, CI fails.
- File-level isolation: config is injected, so most tests build a `Config`/`AuditConfig` literal (or call `loadConfig(env)` with an explicit env slice) instead of mutating `process.env`. A couple of modules keep process-lifetime caches (the audit-log append queue + `chmodEnsured` flag, the shared `TokenStorage`); their tests `vi.resetModules()` or call the `_resetTokenStorage()` hook. Tests that touch the filesystem clean up after themselves with `beforeEach`/`afterEach`.

## Before opening a PR

- [ ] `bun run lint:check` passes
- [ ] `bun run lint:types` passes
- [ ] `bun run test:coverage` passes (no threshold failures)
- [ ] Commit messages follow Conventional Commits
- [ ] If you added/removed/renamed a tool, update `README.md` and `CLAUDE.md`

CI runs all of the above on every PR.
