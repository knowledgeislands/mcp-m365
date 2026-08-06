# CLAUDE.md

Guidance for Claude Code when working in this repo. The user-facing tool surface, Azure app setup, install/config, and Claude Desktop setup live in [README.md](./README.md); this file covers what Claude needs that isn't in README and isn't derivable from one grep.

## Bun vs Node

This project uses Bun (≥ 1.3) for install and dev scripts, but the compiled `dist/` runs under Node (≥ 22) — that's what Claude Desktop launches.

- `bun run test` (NOT `bun test` — the latter invokes Bun's own runner instead of vitest).
- Bun auto-loads `.env.${NODE_ENV}` from the CWD; Node needs the explicit `process.loadEnvFile()` call inside `loadConfig()` in [src/config/index.ts](./src/config/index.ts). The try/catch swallows the `TypeError` Bun raises (no `process.loadEnvFile`), so the same code works under both.
- `NODE_ENV` is set to `development` only by `server:*:dev` and `ki:server:mcp:inspect`. Claude Desktop doesn't set it, so `.env.*` is ignored in production — `MCP_M365_CLIENT_ID` / `MCP_M365_CLIENT_SECRET` must come from the Claude Desktop config `env` block.

Run `bun run` with no args for the full script list. `bun run ki:test:smoke` boots the server over stdio and asserts the wire-level tool surface matches `EXPECTED_TOOLS` in [scripts/smoke.ts](./scripts/smoke.ts) — keep that list in sync when adding or removing tools.

## Architecture Invariants

### Project layout & config injection (the workspace MCP shape)

This is the canonical layout we roll out across the MCPs:

- **[src/config/index.ts](./src/config/index.ts)** — `loadConfig(env?) → Config`. Reads env (optionally hydrated from `.env.${NODE_ENV}`) into a plain `Config` value. **There is no module-level config singleton — nothing reads `process.env` at import time.** Genuinely static, non-env constants (server name/version, `GRAPH_API_ENDPOINT`, the `$select` field lists, page-size defaults, `M365_DEFAULT_SCOPES`, `AccessLevel`/`AuditLogMode` types + rank tables) stay as plain module exports — they read no env and never differ per run.
- **[src/mcp-server/index.ts](./src/mcp-server/index.ts)** — the stdio MCP wrapper. Calls `loadConfig()` once, then threads `Config` into the access gate, the shared token storage (`initTokenStorage(config)`), and tool registration. Startup logging reads from `config`.
- **[src/auth-server/index.ts](./src/auth-server/index.ts)** — the OAuth callback server, a second top-level entry. Also calls `loadConfig()` once at boot and uses `config.auth`.
- **[src/tools/](./src/tools/)** — MCP tool definitions, one `index.ts` per `<service>` (`auth`, `calendar`, `email`, `folder`, `onedrive`, `rules`). These are **thin**: each `server.registerTool(...)` call declares the zod `inputSchema` (+ `outputSchema` where the tool returns `structuredContent`), the annotation preset, and a handler imported from `main/`. There is **no logic and no non-`index.ts` file** under `src/tools/` — everything else moved to `main/`. All `tools/**/index.ts` are coverage-excluded.
- **[src/main/](./src/main/)** — the real implementation, grouped by concern, each with an `index.ts` re-export and surfaced via the package `exports` map: `main/email/`, `main/folder/`, `main/calendar/`, `main/onedrive/`, `main/rules/`, `main/triage/` (the `m365_*` handlers), plus `main/graph-client/index.ts` (the Microsoft Graph HTTP layer), `main/auth/index.ts` (hand-rolled token persistence/refresh, the config-injected `createTokenStorage(cfg)` factory, and `ensureAuthenticated`), and `main/auth/handlers.ts` (`m365_about` / `m365_auth_start` / `m365_auth_status`). `main/` functions take their config slice (or the specific primitive) and contain no `console.*` — they return data; the tool layer maps it to an envelope and only `mcp-server`/stderr prints. Concern modules are unit-tested to 100% on all four coverage metrics.
- **[src/utils/](./src/utils/)** — cross-MCP reusable helpers; keep in sync with sibling repos. These take the **specific config primitive/slice** they need (`makeAccessGatedRegister(server, accessLevel, audit)`, `withAuditLog(auditConfig, …)`), not the whole `Config`, so they stay MCP-agnostic. Like `main/`, these return data rather than print — the one sanctioned exception is `audit-log.ts`, which writes a single stderr line if (and only if) writing the audit log itself fails, since a broken log must never abort a tool call.

To use the code from a script: `const cfg = loadConfig(); const ts = createTokenStorage(cfg)`.

### Two processes

- `mcp-m365` — the stdio MCP server (entry: `dist/mcp-server/index.js`).
- `mcp-m365-auth` — long-running OAuth callback server on `:3333` (entry: `dist/auth-server/index.js`). Must be up to complete the `m365_auth_start` flow.

Token persistence + refresh is hand-rolled in [src/main/auth/index.ts](./src/main/auth/index.ts) — no MSAL dependency. The `TokenStorage` instance is **not** a module-level singleton: each entry point calls `initTokenStorage(loadConfig())` at boot, and `ensureAuthenticated()` / `handleCheckAuthStatus` read it via `getTokenStorage()` (which throws if accessed before init). `_resetTokenStorage()` is a test hook.

### Naming convention

Tool names follow the canonical workspace scheme `<app>_<resource>_<action>` (snake case) with `<app>` = `m365`. In this repo the `<resource>` is compound — a `<service>_<thing>` pair with `<service>` ∈ {`email`, `calendar`, `onedrive`} — so a full name reads as `m365_email_message_get`, `m365_calendar_event_create`, `m365_onedrive_item_upload`. Plural resource for collection ops (`m365_email_messages_list`), singular for single-item ops (`m365_email_message_get`). The auth/metadata tools (`m365_about`, `m365_auth_start`, `m365_auth_status`) drop the resource segment.

### Access-level gate — driven by annotations, not names

[src/utils/access-level.ts](./src/utils/access-level.ts) `makeAccessGatedRegister(server, accessLevel, audit)` decides at startup whether to register each tool, based on `config.annotations`:

- `readOnlyHint: true` → `read`
- `destructiveHint: true` → `destructive`
- explicit `readOnlyHint: false` AND `destructiveHint: false` → `write` (non-destructive Graph mutation)
- anything else (unannotated / partially annotated) → `destructive` (fail-safe)

A tool registers when its derived level is at or below `MCP_M365_ACCESS_LEVEL` (default: `read`). Levels nest: `read` registers only readers; `write` adds non-destructive mutations like `m365_email_message_send` and `m365_calendar_event_create`; `destructive` adds delete/overwrite. New tools MUST set `annotations` to one of the presets in [src/utils/annotations.ts](./src/utils/annotations.ts) — `READ_ONLY`/`READ_ONLY_REMOTE` for pure reads; `WRITE_REMOTE`/`WRITE_IDEMPOTENT_REMOTE` for non-destructive Graph mutations; `DESTRUCTIVE_REMOTE` for deletes whose end state is the same however often they run; `DESTRUCTIVE_ONESHOT_REMOTE` where a repeat does more work rather than converging (the batch-bounded routing passes, which process the _next_ batch on each call). Annotations must be honest about what the tool does — `m365_auth_start` is `WRITE_REMOTE` (not `READ_ONLY_REMOTE`) because it persists tokens to disk; misrepresenting it would silently classify it as `read` under the gate. Do not bypass the proxy.

## Security Requirements

This server holds OAuth refresh tokens that grant Outlook read/write/send, Calendar read/write, and OneDrive read/write across the user's tenant. Token leakage = mailbox + drive compromise. Destructive Graph operations cannot be undone via Graph itself. New tools and changes to existing tools MUST preserve every invariant below.

1. **Tokens are never logged.** [src/main/auth/index.ts](./src/main/auth/index.ts) does not print at all — as a `main/` layer it returns/throws data rather than logging (a missing/unreadable token cache is reported by a `null` return; an unconfigured OAuth client surfaces as a thrown error from `exchangeCodeForTokens`/`refreshAccessToken`). `m365_auth_status` returns presence + scope + expiry only. Any future error surfacing must carry only safe fields (`error.code`, `error.message`) and never token contents.
2. **Token persistence is atomic and `0600`.** `_saveTokensToFile()` writes to `<path>.tmp.<pid>.<rand>` then `fs.rename` into place; both temp and final files use `mode: 0o600`. Refresh and exchange flows both go through `_saveTokensToFile` — keep it that way.
3. **Refresh deduplication.** `_refreshPromise` ensures concurrent `getValidAccessToken()` callers share a single refresh request. New auth code must preserve the dedupe — without it a burst of tool calls would race for token persistence.
4. **All Zod schemas are `.strict()` with bounded numerics.** Already true; new schemas must continue this — e.g. `count` is `z.number().int().positive().max(50)` for calendar/onedrive listings, `.max(1000)` for email; `sequence` (rule ordering) is `.min(0).max(10000)`.
5. **Destructive tools expose `dry_run` (default `true`).** Every `DESTRUCTIVE_REMOTE` tool (`m365_email_message_delete`, `m365_calendar_event_{delete,cancel,decline}`, `m365_email_folder_delete`, `m365_onedrive_item_delete`) returns a `[dry_run] would …` preview by default and only mutates when the caller passes `dry_run: false`.
6. **OneDrive caller-supplied paths must go through `sanitizeOneDrivePath()`** in [src/utils/odata-helpers.ts](./src/utils/odata-helpers.ts) before interpolation into `me/drive/root:/...` endpoints. It strips outer slashes, splits on `/`, rejects `:`/`\`/empty/`.`/`..` segments, and `encodeURIComponent`s each remaining segment. Never interpolate raw paths.
7. **`ensureAuthenticated()` is the auth gate.** Every Graph-calling handler must `await ensureAuthenticated()` first — it returns the access token (refreshing if needed). Bypassing it (e.g. reading `tokenStorage.tokens` directly) risks expired tokens AND ignores the refresh-dedup machinery.
8. **401 hint surfaces remediation.** `errMessage()` in [src/utils/errors.ts](./src/utils/errors.ts) appends `Run the m365_auth_start tool to refresh the OAuth token.` on 401 (or matching message keywords). New tools must use `errorResult(action, err)` so this contract holds.
9. **No shell-string interpolation.** This server doesn't shell out. If a future tool needs to, use `execFile` with an argv array.
10. **If a future tool writes Graph response bytes to disk, add a configurable download root** (e.g. `MCP_M365_DOWNLOAD_PATH`, default `~/Downloads`) and validate `outputPath` via a two-layer (lexical + realpath) helper, mirroring [`assertOutputPathWithinDownloadRoot()`](../mcp-gmail/src/utils/paths.ts) in mcp-gmail. Today, `m365_onedrive_item_download` returns a pre-authenticated URL rather than writing bytes.
11. **Full URLs are host-pinned before the Bearer token is attached (SSRF — workspace standard §13.5).** `callGraphAPI` only ever receives a full URL via an `@odata.nextLink` echoed back in a prior Graph response; that value is server-controlled and treated as untrusted. `assertGraphUrl()` in [src/main/graph-client/index.ts](./src/main/graph-client/index.ts) asserts the scheme is `https:` and the host is exactly `graph.microsoft.com` (derived from `GRAPH_API_ENDPOINT`) before the token is sent, so a forged/tampered nextLink can never exfiltrate the access token to another origin. Never bypass it when following pagination.

Atomic-write, mode-0600, redacted summary, refresh-dedup, and nextLink host-pin tests live in [src/main/auth/index.test.ts](./src/main/auth/index.test.ts) and [src/main/graph-client/index.test.ts](./src/main/graph-client/index.test.ts).

## Tool registration call sites

Each `<service>` registers its tools in `src/tools/<service>/index.ts` (`auth`, `calendar`, `email`, `folder`, `onedrive`, `rules`, `triage`). To survey the surface, `grep "registerTool" src/tools/*/index.ts`. README's [Available Tools](./README.md#available-tools) tabulates them with purposes.

## Email routing engine (`main/triage/`)

A deterministic replacement for LLM-interpreted email triage: rules are data, the engine is code. Four things about it are load-bearing and easy to break.

1. **The server holds no rule state.** Rules arrive as a string in every call; the caller's rule file is canonical. Do not add server-side rule storage or caching.
2. **Message identity is subject + sender + received timestamp, never the Graph id.** Graph reissues ids on folder moves, so an id is a cache hint that `findMessage` re-verifies before any mutation — and a `move` reissues the id again, which is why `applyOne` threads the new one into the actions that follow.
3. **Calls are batch-bounded and resumable, never long-running.** `maxActions` caps mutations per call and the result reports `remaining`; the caller loops. For the triage and aged passes progress is implicit — classification moves a message out of the folder being scanned, so a re-run finds less work. The drift scan has no such natural progress (it re-reads the same cache), so it carries an explicit **sweep cursor**: `scanned_at` per entry plus a `sweep.started_at` marker on the file. `remaining` must count what is outstanding in the current sweep and reach zero when the sweep completes — a `remaining` derived from `total - batchSize` is a constant and makes the documented polling loop non-terminating.
4. **Ordering is the whole specification.** The list is flat and first-match-wins, so the two lint checks that matter are `shadowed-rule` (a rule that can never fire) and `broad-rule-collision` (a content-agnostic rule sitting above the specific rules it will swallow — the class of bug that sent project calendar invites to the action folder). A reviewed collision is silenced with a `# lint:allow-collision` comment on the rule, not by weakening the check.

`parser.ts`, `matcher.ts`, `lint.ts` and `folders.ts` are pure — no clock, no Graph, no I/O (`age:` takes an injected `now`). Keep them that way: `replay.test.ts` asserts the Phase 3 replay findings against exactly the code that runs live, and that only holds while classification is a pure function. `fixtures/routing/email-routing-rules.md` is a vendored snapshot of the rule note so the suite runs without the knowledge base mounted — re-copy it when the note changes.

## MCP spec conformance

This server targets MCP spec revision **2025-11-25** (the latest released revision; see the workspace MCP standard §12–13). Tool-execution errors are returned as `isError: true` envelopes via `errorResult` (never thrown), and structured output is paired with an `outputSchema` (below).

**RFC 8707 `resource`/`aud` audience validation is deliberately N/A here.** That requirement (spec §13 item 7, AUTH 2025-11-25) governs a server acting as a _remote HTTP OAuth resource server_ — validating that an inbound bearer token's audience is itself. This server is an OAuth **client** of Microsoft Graph, runs over **stdio**, and obtains its own tokens via the loopback consent flow: no caller-supplied bearer ever crosses the client↔server boundary, so there is nothing to audience-validate. The live token-passthrough defence is that we never accept or forward a caller-supplied token (we only use tokens issued to ourselves for Graph). This goes live only if the server is ever deployed as a remote resource server. Likewise, Client ID Metadata Documents (§13 item 8) apply only to an _authorization-server_ role we do not occupy.

## Structured output (spec §12)

The three tools that emit `structuredContent` — `m365_email_messages_list`, `m365_email_messages_search`, `m365_email_folders_list` — pair it with a matching `outputSchema` at registration. The schema and the emitted object are derived from the **same** zod result schema (`emailListResultSchema` / `emailSearchResultSchema` in [src/main/email/](./src/main/email/), `folderListResultSchema` in [src/main/folder/list.ts](./src/main/folder/list.ts)) so they cannot drift; the SDK validates the returned `structuredContent` against it on success. The schemas are `.loose()` so the raw Graph `items` and future fields pass. The handlers also keep the backwards-compat serialized-text content block. A new tool that returns `structuredContent` MUST declare its `outputSchema` from the same zod schema.
