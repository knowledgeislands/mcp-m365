# Local development

Use this guide when preparing a source change to this repository. It covers the toolchain, running either server from source, finding your way around `src/`, and the verification gate a change has to pass.

## Before you begin

- [Bun](https://bun.sh) 1.3 or newer for installing, developing, and testing. Use `bun run test`, never `bun test` — the two are not the same runner and the second does not honour this repository's Vitest configuration.
- Node.js 22 or newer, which is what the published `dist/` servers run under.
- A working Azure registration and credentials in `.env.development` if you intend to exercise anything that reaches Microsoft Graph. Most work does not: the unit tests use isolated fixtures rather than a real account.

```bash
bun install
```

## Run either server from source

```bash
cp .env.example .env.development
# fill in your Azure credentials, then:
bun run ki:server:mcp:dev    # MCP server, bun --watch
bun run ki:server:auth:dev   # OAuth callback server on :3333, bun --watch
```

Both development scripts set `NODE_ENV=development`, which is what causes `.env.development` to be loaded. Configuration is hydrated from `.env.local`, then `.env.${NODE_ENV}`, then `.env`, highest precedence first, and a variable already present in the environment beats all three — so under an MCP client that does not set `NODE_ENV`, the client's `env` block is the only thing being read. [Configure the server](../user/configuration.md) states the full precedence rule.

To run the compiled build under Node instead of the source under Bun:

```bash
bun run ki:server:mcp:start    # build, then node dist/mcp-server/index.js
bun run ki:server:auth:start   # build, then node dist/auth-server/index.js
```

To drive the tool surface interactively, use the MCP Inspector against the TypeScript source:

```bash
bun run ki:server:mcp:inspect
```

Remember that the access-level gate applies here as it does anywhere. A tool you are developing does not appear in the Inspector until `MCP_M365_ACCESS_LEVEL` is at or above its derived level.

## Where the code lives

```text
├── claude-config-sample.json        # Example MCP client config
├── .env.example                     # Template for MCP_M365_* vars (copy to .env.development)
├── src/
│   ├── config/index.ts              # loadConfig(env?) → Config; no module-level env reads
│   ├── mcp-server/index.ts          # MCP server entry point
│   ├── auth-server/index.ts         # Standalone OAuth callback server (port 3333)
│   ├── main/                        # Implementation, reusable outside the MCP server
│   │   ├── auth/index.ts            # Token persistence/refresh + createTokenStorage(cfg)
│   │   ├── graph-client/index.ts    # Microsoft Graph HTTP layer (retries + refresh)
│   │   ├── email/ calendar/ folder/ # Per-concern handlers
│   │   ├── onedrive/ rules/         #
│   │   ├── triage/                  # The deterministic routing engine
│   │   └── attachments/             # Attachment extraction for save-attachments:
│   ├── tools/                       # Thin registration shells, one index.ts per service
│   └── utils/
│       ├── access-level.ts          # Access-level gate
│       ├── annotations.ts           # MCP annotation presets
│       ├── audit-log.ts             # JSONL audit log + size-based rotation
│       ├── html-sanitizer.ts        # HTML body sanitisation
│       ├── odata-helpers.ts         # OData query building
│       └── paths.ts                 # Root-bounded path resolution
└── dist/                            # Build output (gitignored, created by bun run build)
```

Three splits in that tree are load-bearing rather than stylistic, and a change that blurs one of them will fail review even if it passes every gate:

**`tools/` versus `main/`.** `src/tools/<service>/index.ts` is a thin registration shell: it declares the Zod input schema, the annotation preset, and a handler imported from `main/`. There is no logic and no non-`index.ts` file under `src/tools/`. The implementation lives in `src/main/<concern>/`, is reusable outside the MCP server, is surfaced through the package `exports` map, and returns data rather than printing — the tool layer maps that data to an MCP envelope.

**`auth-server/` versus `main/auth/`.** The first is the standalone OAuth callback server; the second is the reusable token storage and refresh layer that both entry points consume through the config-injected `createTokenStorage(cfg)` factory. They are deliberately decoupled so the callback server can run independently of the MCP server.

**Configuration is injected, never imported.** Both entry points call `loadConfig()` once at boot and thread the resulting `Config` into the access gate, token storage, and tool registration. Nothing reads `process.env` at import time and there is no configuration singleton. `src/utils/` goes further and takes the specific slice or primitive it needs rather than the whole `Config`, so those helpers stay reusable across the sibling MCP repositories.

[CLAUDE.md](../../../CLAUDE.md) states these invariants in full, including the per-connection server factory and the naming convention for tool names.

## Run the verification gate

```bash
bunx tsc -p tsconfig.json --noEmit   # whole-tree typecheck, including tests and scripts
bunx @biomejs/biome check .          # lint and format, as lint-staged enforces on commit
bun run test                         # vitest
bun run test:coverage                # vitest with thresholds
bun run build                        # tsc -p tsconfig.build.json
bun run ki:test:smoke                # build, then a real MCP client against the server
bunx rumdl check                     # authored Markdown
ki repo audit --concise --progress never
```

Coverage is enforced at 100% on lines, functions, branches, and statements. The exclusions are deliberate and narrow: the server entry points, the `tools/**/index.ts` registration shells, and the pure-data annotation presets carry no logic, and the smoke test covers the wiring they represent. Anything you add under `src/main/` or `src/utils/` is expected to reach 100%, and lowering a threshold is not the way to land a change.

The smoke test is the only assertion that the live wire works: it builds, starts a real client against the server, and checks protocol negotiation, discovery, an actual `tools/call`, argument rejection, and the legacy fallback. A change to the entry points or the protocol profile is not verified until it passes.

`ki repo audit` runs the repository's declared governance skills. Run the focused form — `ki repo audit --skill <name> --concise --progress never` — while iterating on one concern.

## Exercise the Graph surface without an account

Integration coverage uses recorded fixtures rather than a live mailbox:

```bash
bun run ki:test:replay   # replay the committed recording
bun run ki:test:record   # re-record against a live account, then copy into fixtures/
```

Recording touches a real Microsoft 365 account and needs explicit authority before you run it. Replay does not, and is what you want for ordinary development.

Tests use isolated fixtures rather than real accounts, mailboxes, calendars, drives, or token stores. That is a data-safety rule, not a convenience: a test that reaches a live mailbox can delete mail.

## Before you hand a change over

- Every gate above passes, including coverage at 100%.
- No `console.*` was added under `main/` or `utils/`, with the single sanctioned exception already in `audit-log.ts`.
- No new module-level `process.env` read, and no configuration singleton.
- Any new tool sets an explicit annotation preset and is registered through the access-gated proxy — see [Extend the server](extending-the-server.md).
- No access or refresh token is logged or returned by any code path.
- Where the change alters setup, credentials, or recovery, the corresponding [user guide](../user/README.md) changed with it.
