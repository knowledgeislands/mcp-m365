# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

Two processes:

- `mcp-m365` — the stdio MCP server (entry: `dist/mcp-server/index.js`).
- `mcp-m365-auth` — the standalone OAuth callback server on `:3333` (entry: `dist/auth-server/index.js`). Long-running; must be up while you run the `authenticate` tool.

Scripts:

- `npm install` — **ALWAYS run first**.
- `npm run dev:mcp` — Run the MCP server from TS source in tsx watch mode (`NODE_ENV=development`).
- `npm run dev:auth` — Run the auth server from TS source in tsx watch mode.
- `npm run start:mcp` / `npm run start:auth` — Build and run from `dist/`.
- `npm run build` — Compile TS to JS in `dist/` (uses `tsconfig.build.json`, excludes tests).
- `npm run typecheck` — `tsc --noEmit`.
- `npm run inspect` — MCP Inspector against TS source.
- `npm test` — vitest.
- `npm run lint:check` / `lint:fix` — Biome.
- `npm run lint:md` — prettier + markdownlint for `*.md`.
- `npx kill-port 3333` — Free port 3333 if the auth server won't start.

## Architecture Overview

`mcp-m365` wraps Microsoft Graph behind an MCP stdio server. Auth uses Microsoft OAuth 2.0 with a separate long-running HTTP callback server. Token persistence + refresh is hand-rolled in `src/auth.ts` (no MSAL dependency).

Flow:

1. Register an app in Azure Portal > App Registrations, add a Web redirect URI matching `MCP_M365_REDIRECT_URI` (default `http://localhost:3333/auth/callback`), and create a client secret. Put the values in `MCP_M365_CLIENT_ID` / `MCP_M365_CLIENT_SECRET`.
2. Start `mcp-m365-auth` (e.g. `npm run dev:auth`). It listens on `http://localhost:3333` by default; override with `MCP_M365_AUTH_PORT`.
3. From an MCP client, call the `authenticate` tool — it returns the consent URL.
4. Open that URL in a browser. Microsoft redirects to `http://localhost:3333/auth/callback?code=…` which the auth server captures.
5. The auth server POSTs the code to the token endpoint and persists the result atomically to `AUTH_CONFIG.tokenStorePath` (default `~/.mcp-m365-tokens.json`).
6. The MCP server reads the token file on its next API call. `TokenStorage` in `src/auth.ts` proactively refreshes when the access token is within 5 min of expiry and persists the refreshed token back atomically.

### Source Layout

TypeScript with ES modules (`"type": "module"`). Source under `src/`, compiled JS in `dist/`.

- `src/config.ts` — `AUTH_CONFIG` (client ID/secret from env, redirect URI, scopes, port, token store path with `~/.mcp-m365-tokens.json` default) plus Graph API constants (`GRAPH_API_ENDPOINT`, field selectors, default page size).
- `src/auth.ts` — `TokenStorage` class: loads + persists tokens (atomic write, mode `0600`), exchanges authorization codes, refreshes the access token via hand-rolled `https` POST, dedupes concurrent refreshes. Exports the shared `tokenStorage` singleton.
- `src/auth-server/index.ts` — HTTP callback server: `/auth` (CSRF state + consent redirect), `/auth/callback` (state validation + token exchange), `/` (info page).
- `src/auth-server/templates.ts` — HTML templates for the auth-server responses.
- `src/mcp-server/index.ts` — Boots `McpServer`, registers all tool modules, connects stdio transport.
- `src/tools/index.ts` — aggregator re-exporting `registerXxxTools(server)` helpers.
- `src/tools/auth/` — `about`, `authenticate`, `check-auth-status`; `ensureAuthenticated()` returned to other tool handlers.
- `src/tools/calendar/` — list/create/cancel/accept/decline/delete events.
- `src/tools/email/` — list/search/read/send/draft/mark-as-read/delete email.
- `src/tools/folder/` — list/create/rename/delete folders; move emails.
- `src/tools/onedrive/` — list/search/download/upload (small + chunked)/share/create-folder/delete.
- `src/tools/rules/` — Outlook inbox rules: list, create, edit-sequence.
- `src/utils/annotations.ts` — MCP tool annotation presets.
- `src/utils/errors.ts` — `errMessage()` extracts HTTP status + Graph API error message, and appends a `Run the authenticate tool to refresh the OAuth token.` hint when the status is 401.
- `src/utils/graph-api.ts` — Graph API client helpers; authenticated requests against `GRAPH_API_ENDPOINT`.
- `src/utils/odata-helpers.ts` — OData filter/expand builders.
- `src/utils/html-sanitizer.ts` — strips HTML in message bodies when only plain-text is wanted.

### Token Handling

The four requirements drove these choices:

1. **Refresh reliability** — `TokenStorage.getValidAccessToken()` checks expiry with a 5-min buffer before every API call; on stale tokens it kicks off a refresh, deduped via `_refreshPromise` so concurrent callers share a single refresh. A failed refresh clears the in-memory token and the file.
2. **Atomic write** — `_saveTokensToFile()` writes to `<path>.tmp.<pid>.<rand>` then `fs.rename` into place. POSIX guarantees `rename` is atomic on the same filesystem, so a crash mid-write cannot corrupt the token file.
3. **Mode `0600`** — Both the temp file and final file are created with `mode: 0o600`.
4. **Never leak token values** — `check-auth-status` returns a redacted summary (`authenticated`, `hasRefreshToken`, `scope[]`, `expiresAt`, `tokenStorePath`) — never the access or refresh token. No other tool returns token material.

### Tool Registration Pattern

Each module exports `registerXxxTools(server)` and uses Zod input schemas + MCP tool annotations imported from `src/utils/annotations.ts`. `src/mcp-server/index.ts` composes these helpers.

### Available Tools

Auth tools are server-level; resource tools are grouped by Graph API area.

- **auth** — `about`, `authenticate`, `check-auth-status`
- **calendar** — `calendar_list_events`, `calendar_create_event`, `calendar_cancel_event`, `calendar_accept_event`, `calendar_decline_event`, `calendar_delete_event`
- **email** — `email_list`, `email_search`, `email_read`, `email_send`, `email_draft`, `email_mark_as_read`, `email_delete`
- **folder** — `folder_list`, `folder_create`, `folder_rename`, `folder_delete`, `folder_move_emails`
- **onedrive** — `onedrive_list`, `onedrive_search`, `onedrive_download`, `onedrive_upload`, `onedrive_upload_large`, `onedrive_share`, `onedrive_create_folder`, `onedrive_delete`
- **rules** — `rules_list`, `rules_create`, `rules_edit_sequence`

### Key Components

- **MCP wiring**: `src/mcp-server/index.ts` constructs `McpServer` and calls each module's `registerXxxTools`. Initialize / `tools/list` / `tools/call` are handled by the SDK — there is no custom `fallbackRequestHandler`.
- **Token mgmt**: `TokenStorage` in `src/auth.ts`; shared singleton exported as `tokenStorage` so `ensureAuthenticated()` (in `src/tools/auth/index.ts`) and `handleCheckAuthStatus` reuse the same in-memory cache and refresh deduplication.
- **Graph API client**: `src/utils/graph-api.ts` builds authenticated requests against `GRAPH_API_ENDPOINT`. Each tool handler calls `await ensureAuthenticated()` to get an access token, then passes it to the Graph helper.
- **Error shape**: Tool errors return `{ isError: true, content: [{ type: 'text', text }] }` via `errorResult()`. Successful tools return JSON via `jsonResult()`. 401 errors get a `Run the authenticate tool to refresh the OAuth token.` hint appended in `src/utils/errors.ts`.
- **Transport**: `StdioServerTransport` from `@modelcontextprotocol/sdk`. Logs go to stderr (`console.error`) so they don't pollute the stdio MCP channel.

## Authentication

### Graph API (Outlook + OneDrive)

1. Azure app registration required with the following delegated permissions: `Mail.Read`, `Mail.ReadWrite`, `Mail.Send`, `Calendars.Read`, `Calendars.ReadWrite`, `Files.Read`, `Files.ReadWrite`, `User.Read`, `offline_access`.
2. Start auth server: `npm run dev:auth` (or `npm run start:auth` for the compiled build).
3. Call the `authenticate` tool to get the consent URL.
4. Complete the browser flow. The auth server captures the callback and persists the token to `~/.mcp-m365-tokens.json` atomically.
5. Subsequent tool calls refresh the access token automatically when within 5 min of expiry. `check-auth-status` reports the current state without leaking token values.

## Configuration

### Environment Variables

| Name                       | Required | Default                                  | Purpose                                                                  |
| -------------------------- | -------- | ---------------------------------------- | ------------------------------------------------------------------------ |
| `MCP_M365_CLIENT_ID`       | yes      | —                                        | Azure app (client) ID.                                                   |
| `MCP_M365_CLIENT_SECRET`   | yes      | —                                        | Azure client secret **value** (not the Secret ID).                       |
| `MCP_M365_TENANT_ID`       | no       | `common`                                 | Azure tenant GUID. Use a specific GUID for single-tenant apps.           |
| `MCP_M365_AUTHORITY_HOST`  | no       | `https://login.microsoftonline.com`      | Override for sovereign clouds (US Gov, China, etc).                      |
| `MCP_M365_REDIRECT_URI`    | no       | `http://localhost:3333/auth/callback`    | Must match the URI registered in Azure.                                  |
| `MCP_M365_SCOPES`          | no       | (canonical list in `src/config.ts`)      | Space-separated OAuth scopes. Defaults include `offline_access`.         |
| `MCP_M365_AUTH_PORT`       | no       | `3333`                                   | Auth server port. Must match the port in `MCP_M365_REDIRECT_URI`.        |
| `MCP_M365_TOKEN_ENDPOINT`  | no       | derived from authority + tenant          | Override only if your authority uses a non-standard token endpoint path. |
| `MCP_M365_AUDIT_LOG`       | no       | `writes`                                 | Scope of the JSONL audit log: `off` (disabled), `writes` (state-mutating tools), `all` (every tool). Unknown values abort startup. |
| `MCP_M365_AUDIT_LOG_PATH`  | no       | `~/.local/state/mcp-m365/audit.jsonl`    | Audit log file path. Created with mode `0o600`. See [src/utils/audit-log.ts](./src/utils/audit-log.ts). |
| `NODE_ENV`                 | no       | —                                        | `dev:*`/`inspect` scripts set `development` so `.env.development` loads. |

`src/config.ts` calls `process.loadEnvFile('./.env.${NODE_ENV}')` at startup, try/caught so a missing file is fine. Claude Desktop doesn't set `NODE_ENV`, so production env comes from the Claude Desktop config `env` block.

### Boot-time Checks

- The MCP server logs `SERVER_NAME` before connecting the transport.
- The auth server logs `MCP_M365_CLIENT_ID` / `MCP_M365_CLIENT_SECRET` presence at startup and warns if missing — token refresh will fail without them.

## Security Requirements

This server holds OAuth refresh tokens that grant Outlook read/write/send, Calendar read/write, and OneDrive read/write across the user's tenant. Token leakage = mailbox + drive compromise. Destructive Graph operations (delete event, delete email, delete onedrive item) cannot be undone via Graph itself. New tools and changes to existing tools must preserve every invariant below.

1. **Tokens are never logged.** No `console.log` / `console.error` of token values, refresh tokens, or any object that contains them. [src/auth.ts](./src/auth.ts) logs status strings only (`Tokens loaded from file.`, `Access token refreshed and saved successfully.`) — never the token contents. `handleCheckAuthStatus` returns presence + scope + expiry only. New code that handles tokens must follow the same discipline; if an error must be logged, redact or extract only the safe fields (`error.code`, `error.message`) rather than logging the raw error object.
2. **Token persistence is atomic and `0600`.** `_saveTokensToFile()` writes to `<path>.tmp.<pid>.<rand>` then `fs.rename` into place; both temp and final files use `mode: 0o600`. A crash mid-write cannot corrupt the token file. Refresh and exchange flows both go through `_saveTokensToFile` — keep it that way.
3. **Refresh deduplication.** `_refreshPromise` ensures concurrent `getValidAccessToken()` callers share a single refresh request. Without it, a burst of tool calls would each trigger a separate refresh and race for token persistence. New auth code must preserve the dedupe.
4. **All Zod schemas are `.strict()` with bounded numerics.** Every registered tool's `inputSchema` is a `z.object({...}).strict()` so unknown fields are rejected at the MCP layer. Numeric inputs are bounded — `count` is `z.number().int().positive().max(50)` for calendar/onedrive listings, `.max(1000)` for email; `sequence` (rule ordering) is `z.number().int().min(0).max(10000)`. New tool registrations must follow this pattern; numeric inputs without bounds let callers exhaust Graph quota.
5. **Destructive tools expose `dry_run` (default `true`).** `email/delete`, `calendar/delete`, `calendar/cancel`, `calendar/decline`, `onedrive/delete`, `folder/delete` all accept a `dry_run` argument that defaults to `true`. The dry-run path fetches target metadata (subject/path/size) and returns a `[dry_run] would …` preview without calling the destructive Graph endpoint. Callers must pass `dry_run: false` to actually mutate. New `DESTRUCTIVE_REMOTE` tools must follow this pattern.
6. **No filesystem write tool currently exposes a caller-provided `outputPath`.** `onedrive_download` returns a pre-authenticated download URL rather than writing bytes; uploads take content from args. If a future tool writes Graph response bytes to disk, add a configurable download root (e.g. `MCP_M365_DOWNLOAD_PATH`, default `~/Downloads`) and validate `outputPath` against it via a two-layer (lexical + realpath) helper, mirroring `assertOutputPathWithinDownloadRoot()` in mcp-gmail's [src/utils/paths.ts](../mcp-gmail/src/utils/paths.ts).
7. **OneDrive caller-supplied paths must go through `sanitizeOneDrivePath()` before interpolation into `me/drive/root:/...` endpoints.** The helper in [src/utils/odata-helpers.ts](./src/utils/odata-helpers.ts) strips outer slashes, splits on `/`, rejects `:` (Graph's path/id separator) and `\` in any segment, rejects empty / `.` / `..` segments, and `encodeURIComponent`s each remaining segment so `?`, `#`, `&`, etc. can't break out of the path component. All six call sites in `src/tools/onedrive/` (list, folder.list, folder.delete, download, share, upload, upload-large) use it. New OneDrive tools that build `root:/...` endpoints must too — never interpolate raw paths.
8. **`ensureAuthenticated()` is the auth gate.** Every tool handler that calls Graph must `await ensureAuthenticated()` first; it returns the access token (after refresh if needed). Bypassing this — e.g. by reading `tokenStorage.tokens` directly — risks hitting Graph with an expired token and ignores the refresh-dedup machinery. New handlers must use `ensureAuthenticated`.
9. **401 hint surfaces remediation.** `errMessage()` in [src/utils/errors.ts](./src/utils/errors.ts) appends `Run the authenticate tool to refresh the OAuth token.` on 401 (or matching message keywords). New tools must use `errorResult(action, err)` (which routes through `errMessage`) so this contract holds.
10. **No shell-string interpolation.** This server doesn't shell out. If a future tool needs to (e.g. opening a downloaded file), use `execFile` with argv array.

Tests covering atomic token writes, mode-0600, redacted summary, and refresh dedup live in [src/auth.test.ts](./src/auth.test.ts).

## Common Setup Issues

1. **Missing dependencies**: Run `npm install` first.
2. **Wrong secret**: Use the Azure client secret **VALUE**, not the Secret ID (`AADSTS7000215` error).
3. **Auth server not running**: Start `npm run dev:auth` before calling the `authenticate` tool.
4. **Port conflicts**: `npx kill-port 3333` if the OAuth port is in use.
5. **Redirect URI mismatch**: The URI registered in Azure must exactly match `MCP_M365_REDIRECT_URI` (default `http://localhost:3333/auth/callback`).

## Error Handling

- Graph API errors surface via `errorResult(action, err)` as `Error <action>: HTTP <status>: <api-message>`, preserving HTTP status and Microsoft's detailed error message.
- 401 (`Unauthorized` / `InvalidAuthenticationToken` / `TokenExpired`): the message is suffixed with `Run the authenticate tool to refresh the OAuth token.` so callers see the remedy in-line.
- Token refresh failure: clears the in-memory and on-disk token and returns null from `getValidAccessToken()`; the caller will then surface the missing-token error.
- Missing `MCP_M365_CLIENT_ID` / `MCP_M365_CLIENT_SECRET`: token refresh throws `Client ID or Client Secret is not configured.` and the auth server warns at startup.
