# CLAUDE.md

Guidance for Claude Code when working in this repo. The user-facing tool surface, Azure app setup, install/config, and Claude Desktop setup live in [README.md](./README.md); this file covers what Claude needs that isn't in README and isn't derivable from one grep.

## Bun vs Node

This project uses Bun (≥ 1.3) for install and dev scripts, but the compiled `dist/` runs under Node (≥ 22) — that's what Claude Desktop launches.

- `bun run test` (NOT `bun test` — the latter invokes Bun's own runner instead of vitest).
- Bun auto-loads `.env.${NODE_ENV}` from the CWD; Node needs the explicit `process.loadEnvFile()` call in [src/config.ts](./src/config.ts). The try/catch swallows the `TypeError` Bun raises (no `process.loadEnvFile`), so the same code works under both.
- `NODE_ENV` is set to `development` only by `server:*:dev` and `server:mcp:inspect`. Claude Desktop doesn't set it, so `.env.*` is ignored in production — `MCP_M365_CLIENT_ID` / `MCP_M365_CLIENT_SECRET` must come from the Claude Desktop config `env` block.

Run `bun run` with no args for the full script list. `bun run test:smoke` boots the server over stdio and asserts the wire-level tool surface matches `EXPECTED_TOOLS` in [scripts/smoke.ts](./scripts/smoke.ts) — keep that list in sync when adding or removing tools.

## Architecture Invariants

### Two processes

- `mcp-m365` — the stdio MCP server (entry: `dist/mcp-server/index.js`).
- `mcp-m365-auth` — long-running OAuth callback server on `:3333` (entry: `dist/auth-server/index.js`). Must be up to complete the `m365_auth_start` flow.

Token persistence + refresh is hand-rolled in [src/auth.ts](./src/auth.ts) — no MSAL dependency.

### Naming convention

Tool names follow `<app>_<service>_<resource>_<action>` (snake_case) with `<app>` = `m365` and `<service>` ∈ {`email`, `calendar`, `onedrive`}. Plural resource for collection ops, singular for single-item ops. The auth tools (`m365_about`, `m365_auth_start`, `m365_auth_status`) are server-level metadata and drop service/resource segments.

### Role gate — driven by annotations, not names

[src/utils/roles.ts](./src/utils/roles.ts) `makeRoleGatedRegister()` decides at startup whether to register each tool, based on `config.annotations.readOnlyHint`:

- `readOnlyHint: true` → `read` role
- anything else → `write` role (fail-safe; an unannotated tool is treated as destructive)

Only tools whose role is in `MCP_M365_ROLES` (default: `read`) are registered. New tools MUST set `annotations` to one of the presets in [src/utils/annotations.ts](./src/utils/annotations.ts) — `READ_ONLY`/`READ_ONLY_REMOTE` for pure reads; `ADDITIVE_REMOTE`/`STATE_TOGGLE_REMOTE`/`DESTRUCTIVE_REMOTE` for the corresponding Graph mutations. Annotations must be honest about what the tool does — `m365_auth_start` is `ADDITIVE_REMOTE` (not `READ_ONLY_REMOTE`) because it persists tokens to disk; misrepresenting it would silently classify it as `read` under the new gate. Do not bypass the proxy.

## Security Requirements

This server holds OAuth refresh tokens that grant Outlook read/write/send, Calendar read/write, and OneDrive read/write across the user's tenant. Token leakage = mailbox + drive compromise. Destructive Graph operations cannot be undone via Graph itself. New tools and changes to existing tools MUST preserve every invariant below.

1. **Tokens are never logged.** [src/auth.ts](./src/auth.ts) logs status strings only — never token contents. `m365_auth_status` returns presence + scope + expiry only. If an error must be logged, extract only safe fields (`error.code`, `error.message`).
2. **Token persistence is atomic and `0600`.** `_saveTokensToFile()` writes to `<path>.tmp.<pid>.<rand>` then `fs.rename` into place; both temp and final files use `mode: 0o600`. Refresh and exchange flows both go through `_saveTokensToFile` — keep it that way.
3. **Refresh deduplication.** `_refreshPromise` ensures concurrent `getValidAccessToken()` callers share a single refresh request. New auth code must preserve the dedupe — without it a burst of tool calls would race for token persistence.
4. **All Zod schemas are `.strict()` with bounded numerics.** Already true; new schemas must continue this — e.g. `count` is `z.number().int().positive().max(50)` for calendar/onedrive listings, `.max(1000)` for email; `sequence` (rule ordering) is `.min(0).max(10000)`.
5. **Destructive tools expose `dry_run` (default `true`).** Every `DESTRUCTIVE_REMOTE` tool (`m365_email_message_delete`, `m365_calendar_event_{delete,cancel,decline}`, `m365_email_folder_delete`, `m365_onedrive_item_delete`) returns a `[dry_run] would …` preview by default and only mutates when the caller passes `dry_run: false`.
6. **OneDrive caller-supplied paths must go through `sanitizeOneDrivePath()`** in [src/utils/odata-helpers.ts](./src/utils/odata-helpers.ts) before interpolation into `me/drive/root:/...` endpoints. It strips outer slashes, splits on `/`, rejects `:`/`\`/empty/`.`/`..` segments, and `encodeURIComponent`s each remaining segment. Never interpolate raw paths.
7. **`ensureAuthenticated()` is the auth gate.** Every Graph-calling handler must `await ensureAuthenticated()` first — it returns the access token (refreshing if needed). Bypassing it (e.g. reading `tokenStorage.tokens` directly) risks expired tokens AND ignores the refresh-dedup machinery.
8. **401 hint surfaces remediation.** `errMessage()` in [src/utils/errors.ts](./src/utils/errors.ts) appends `Run the m365_auth_start tool to refresh the OAuth token.` on 401 (or matching message keywords). New tools must use `errorResult(action, err)` so this contract holds.
9. **No shell-string interpolation.** This server doesn't shell out. If a future tool needs to, use `execFile` with an argv array.
10. **If a future tool writes Graph response bytes to disk, add a configurable download root** (e.g. `MCP_M365_DOWNLOAD_PATH`, default `~/Downloads`) and validate `outputPath` via a two-layer (lexical + realpath) helper, mirroring [`assertOutputPathWithinDownloadRoot()`](../mcp-gmail/src/utils/paths.ts) in mcp-gmail. Today, `m365_onedrive_item_download` returns a pre-authenticated URL rather than writing bytes.

Atomic-write, mode-0600, redacted summary, and refresh-dedup tests live in [src/auth.test.ts](./src/auth.test.ts).

## Tool registration call sites

Each `<service>` registers its tools in `src/tools/<service>/index.ts` (`auth`, `calendar`, `email`, `folder`, `onedrive`, `rules`). To survey the surface, `grep "registerTool" src/tools/*/index.ts`. README's [Available Tools](./README.md#available-tools) tabulates them with purposes.
