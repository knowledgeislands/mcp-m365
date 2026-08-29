# mcp-m365

[![CI](https://github.com/knowledgeislands/mcp-m365/actions/workflows/ci.yml/badge.svg)](https://github.com/knowledgeislands/mcp-m365/actions/workflows/ci.yml) [![npm version](https://img.shields.io/npm/v/@knowledgeislands/mcp-m365.svg)](https://www.npmjs.com/package/@knowledgeislands/mcp-m365) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

An MCP (Model Context Protocol) server that connects Claude with Microsoft 365 services — Outlook (email, calendar, folders, rules) and OneDrive (files, search, sharing) — through the Microsoft Graph API.

## Features

- **OAuth 2.0** — standalone auth server handles the user consent flow; tokens are cached locally and refreshed transparently.
- **Outlook coverage** — read/search/send/delete email, manage folders + rules, create/accept/decline/cancel calendar events.
- **OneDrive coverage** — list/search/download/upload (with chunked >4 MB upload), create folders, share files.
- **Strict input schemas** — every tool registers a Zod schema with `.strict()`, so `tools/list` reports proper JSON Schema and tool annotations.
- **Modular structure** — the implementation lives in `src/main/<concern>/` (email, calendar, folder, rules, OneDrive); `src/tools/<service>/index.ts` is a thin registration shell that validates args and maps the result to an MCP envelope.

**Quality:** 100% line / branch / function / statement coverage on the `main/` + `utils/` logic, with all destructive paths covered (the wiring-only `mcp-server` / `tools/**/index.ts` / `auth-server` and pure-data modules are coverage-excluded).

## Available Tools

Tool results follow the standard MCP shape (`{ content: [{ type: 'text', text: '…' }] }`) and carry honest annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`).

### Auth & meta

| Tool               | Description                                                                              |
| ------------------ | ---------------------------------------------------------------------------------------- |
| `m365_about`       | Returns information about this MCP M365 server.                                          |
| `m365_auth_start`  | Initiate the OAuth flow and persist tokens to disk (registered at the `write` level).    |
| `m365_auth_status` | Check authentication status — presence + scope/expiry metadata only, never token values. |

### Outlook (Email & Calendar)

| Tool                           | Description                                                             |
| ------------------------------ | ----------------------------------------------------------------------- |
| `m365_email_messages_list`     | List recent emails from inbox, folder path, or explicit folder ID.      |
| `m365_email_messages_search`   | Search emails by query and/or date range. †                             |
| `m365_email_message_get`       | Read email content.                                                     |
| `m365_email_message_send`      | Send a new email.                                                       |
| `m365_email_draft_create`      | Save an email draft.                                                    |
| `m365_email_message_mark_read` | Mark email as read/unread.                                              |
| `m365_email_message_delete`    | Move an email to Deleted Items (or hard delete with `permanent: true`). |
| `m365_calendar_events_list`    | List calendar events.                                                   |
| `m365_calendar_event_create`   | Create calendar event.                                                  |
| `m365_calendar_event_accept`   | Accept event invitation.                                                |
| `m365_calendar_event_decline`  | Decline event invitation.                                               |
| `m365_calendar_event_cancel`   | Cancel a calendar event.                                                |
| `m365_calendar_event_delete`   | Delete calendar event.                                                  |
| `m365_email_folders_list`      | List mail folders.                                                      |
| `m365_email_folder_create`     | Create mail folder.                                                     |
| `m365_email_folder_rename`     | Rename an existing mail folder.                                         |
| `m365_email_folder_delete`     | Delete a mail folder.                                                   |
| `m365_email_messages_move`     | Move emails between folders.                                            |
| `m365_email_rules_list`        | List inbox rules.                                                       |
| `m365_email_rule_create`       | Create inbox rule.                                                      |
| `m365_email_rules_reorder`     | Change the execution order of an existing inbox rule.                   |

† Searches by `query` and/or date range (`receivedAfter`/`receivedBefore`), in inbox, folder path, or explicit folder ID.

### Email routing engine

A deterministic triage engine: a flat, ordered, first-match-wins rule list in a small line DSL, executed mechanically rather than interpreted. The server holds no rule state — your rule file stays the single source of truth. Distinct from `m365_email_rule_*` above, which manage Outlook's own server-side inbox rules.

Rules reach the engine three ways, in precedence order: the `rules` argument (the document inline), the `rulesPath` argument, or `MCP_M365_TRIAGE_RULES_PATH`. Either path form is read at call time, freshly on each call, so editing the note takes effect without a restart.

**Every path the engine touches — configured or passed in a call — must resolve inside `MCP_M365_TRIAGE_ROOTS`, or the call is refused.** That is what makes a caller-supplied path safe: the blast radius is the allowlisted directories and nothing else. The check is two-layer, lexical then `realpath`, so neither `..` traversal nor a symlink pointing out of a root gets through. With no roots configured the engine does no file access at all.

The tracking cache follows the same rules, via `trackingPath` or `MCP_M365_TRIAGE_TRACKING_PATH`, and defaults to `<first root>/.mcp-m365/email-triage/tracking.json5` — beside the knowledge base it describes rather than in a hidden state directory. Add `.mcp-m365/` to that repository's `.gitignore`. Every run reports which tracking file it used, so a mistaken override shows up on the first run rather than the fifth.

| Tool | Purpose |
| --- | --- |
| `m365_email_routing_triage` | Classify Inbox mail against the `inbound` rule block and apply the first matching rule's actions. ‡ |
| `m365_email_routing_aged` | Apply the `aged` retention block across the `_TRIAGE` subfolders. ‡ |
| `m365_email_routing_lint` | Static checks over a rule file — parse errors, unreachable rules, duplicates, broad-rule collisions, unknown move targets. No mailbox access. |
| `m365_email_routing_drift` | Report messages the user has re-routed by hand and prune the tracking cache. Returns the diff; writes no suggestions. Batched — see below. |

‡ Both default to `mode: "report"` — the engine's equivalent of the `dry_run: true` default the destructive tools carry. Nothing is mutated until you pass `mode: "live"`.

Both run tools are annotated `DESTRUCTIVE_ONESHOT_REMOTE` — destructive and explicitly _not_ idempotent, because repeating a call advances to the next batch rather than converging on the same end state.

Both run tools are **batch-bounded and resumable**: a call acts on at most `maxActions` messages (default 50) and reports `remaining`. Loop while `remaining` is true and `acted` is above zero. This keeps every call comfortably inside a client's request timeout without needing long-running calls or server-side cursors — re-invoking after a partial run or a timeout is always safe, because classification moves a message out of the folder being scanned.

`m365_email_routing_drift` is batched the same way, but over the tracking cache rather than a mail folder: call again while `remaining` is above zero. Progress is held in a **persisted sweep cursor** — each entry records when it was last examined, and the file records when the current sweep began — so `remaining` counts what is left in _this_ pass and reaches zero once the pass has covered every tracked message. A caller polling on `remaining` terminates after exactly one full scan; the next invocation starts a fresh sweep. It carries the same `DESTRUCTIVE_ONESHOT_REMOTE` annotation, since each call advances the cursor and may prune entries.

The engine keeps one piece of state, a tracking cache recording what it routed where, at `MCP_M365_TRIAGE_TRACKING_PATH`. Message identity is subject + sender + received timestamp, never the Graph id, because Graph reissues ids on folder moves.

#### Rule DSL (v1)

One rule per logical line, `predicates -> actions [# comment]`, in a fenced ` ```rules v1 ` block. Juxtaposition is AND, `|` is OR across whole AND-groups, `!` negates a single predicate, and `*` matches everything (valid only as the mandatory final fallback). Predicates: `type:`, `party:`, `sender:`, `to:`, `cc:`, `subject:`, `body:`, `importance:`, `status:`, `age:`, `folder:`. Actions: `move:`, `tag:`, `mark:`, `delete`, `suggest`.

```rules v1
sender:*@vendor.example.com !subject:sign  -> move:981 Delete   # keep signature requests visible
party:*@partner.example.com                         -> move:111 Partner
subject:"NTN Forum" | subject:NTN-Forum -> move:111 Partner
*                                      -> move:000 Unknown, suggest
```

`move:` targets are `_TRIAGE`-relative unless they contain a `/` or are quoted (`move:"Junk Email"`). Address patterns match exact addresses (`noreply@code.example.net`), any local part at a domain (`*@partner.example.com`), a local-part wildcard (`receipts+*@payments.example.net`), or a domain and its subdomains (`*@*.cloud.example.net`). A bare `*@domain` deliberately does **not** reach subdomains — otherwise a broad disposal rule would silently swallow a later, more specific subdomain rule.

#### Email folder targeting

For `m365_email_messages_list` and `m365_email_messages_search` you can target mail folders in two ways:

- `folder` — well-known folder name (for example `inbox`) or full custom path (for example `Projects/2026/Q2`).
- `folderId` — explicit Microsoft Graph folder ID returned by `m365_email_folders_list`.

When both are provided, `folderId` takes precedence and is used directly.

```json
{
  "name": "m365_email_messages_list",
  "arguments": {
    "folderId": "AAMkAGVmMDEz...",
    "count": 25,
    "includeCount": true
  }
}
```

```json
{
  "name": "m365_email_messages_search",
  "arguments": {
    "folderId": "AAMkAGVmMDEz...",
    "query": "invoice",
    "unreadOnly": true,
    "receivedAfter": "2026-01-01T00:00:00Z",
    "count": 50
  }
}
```

### OneDrive

| Tool                              | Description                |
| --------------------------------- | -------------------------- |
| `m365_onedrive_items_list`        | List files in a path.      |
| `m365_onedrive_items_search`      | Search files by query.     |
| `m365_onedrive_item_download`     | Get download URL.          |
| `m365_onedrive_item_upload`       | Upload small file (<4 MB). |
| `m365_onedrive_item_upload_large` | Chunked upload (>4 MB).    |
| `m365_onedrive_item_share`        | Create sharing link.       |
| `m365_onedrive_folder_create`     | Create folder.             |
| `m365_onedrive_item_delete`       | Delete file or folder.     |

## Quick Start

1. **Install dependencies**: `bun install`.
2. **Register an Azure app** — see [Azure App Registration](#azure-app-registration).
3. **Configure environment** — copy `.env.example` to `.env.development` and add your Azure credentials.
4. **Build**: `bun run build`.
5. **Configure Claude Desktop** with `dist/mcp-server/index.js` and your `MCP_M365_CLIENT_ID`/`MCP_M365_CLIENT_SECRET` (see [Configuration](#configuration)).
6. **Start the auth server**: `bun run ki:server:auth:dev` (separate process; handles OAuth on `localhost:3333`).
7. **Authenticate** — use the `m365_auth_start` tool in Claude, follow the URL, sign in. Tokens are saved to `~/.local/state/ki/mcp-m365/oauth-tokens.json`.

## Example Conversations

Concrete asks you might make of Claude with this server connected.

**Triage by sender and date range:**

> "Find unread emails from `finance@acme.com` received after 2026-04-01 and read the most recent one."

Claude calls [`m365_email_messages_search`](#outlook-email--calendar) with `query: "finance@acme.com"`, `unreadOnly: true`, `receivedAfter: "2026-04-01T00:00:00Z"`, then `m365_email_message_get` on the top result. Both honour mail-folder scoping (`folder` name or explicit `folderId`).

**Draft a reply to a meeting:**

> "Find Alice's invite for tomorrow's planning sync and draft a reply confirming I'll be there."

Claude uses `m365_email_messages_search` + `m365_email_message_get` to locate the invite, then [`m365_email_draft_create`](#outlook-email--calendar) to save the response in your Drafts folder. (Sending an email goes through `m365_email_message_send` — the server exposes both; calendar invites can be accepted directly via [`m365_calendar_event_accept`](#outlook-email--calendar).)

**Upload a file to OneDrive:**

> "Upload `~/Documents/Q2-report.pdf` to OneDrive under `Projects/2026/Q2`. The folder doesn't exist yet — create it."

Claude calls [`m365_onedrive_folder_create`](#onedrive) for the missing path, then [`m365_onedrive_item_upload`](#onedrive) for the file (or [`m365_onedrive_item_upload_large`](#onedrive) if it's over 4 MB; the chunked upload handles arbitrary sizes).

**Review the week's calendar:**

> "Show me my calendar for next week and accept the marketing review invite if it's still open."

Claude calls [`m365_calendar_events_list`](#outlook-email--calendar) with the appropriate date range, finds the marketing review by subject, and runs [`m365_calendar_event_accept`](#outlook-email--calendar) to send the acceptance.

## Installation

### Prerequisites

- [Bun](https://bun.sh) 1.3+ for the dev loop
- Node.js 22+ to run the compiled `dist/` bundle (what Claude Desktop launches)
- An Azure account for app registration

### Install Dependencies

```bash
bun install
```

## Azure App Registration

### App registration

1. Open the [Azure Portal](https://portal.azure.com/).
2. Search for "App registrations".
3. Click "New registration".
4. Name: "MCP M365 Server".
5. Account type: "Accounts in any organizational directory and personal Microsoft accounts".
6. Redirect URI: Web → `http://localhost:3333/auth/callback`.
7. Click "Register".
8. Copy the "Application (client) ID" — you'll put it in `.env.development` as `MCP_M365_CLIENT_ID`.

### API permissions

1. Go to "API permissions" under Manage.
2. Click "Add a permission" → "Microsoft Graph" → "Delegated permissions".
3. Add these permissions:
   - `offline_access`
   - `User.Read`
   - `Mail.Read`, `Mail.ReadWrite`, `Mail.Send`
   - `Calendars.Read`, `Calendars.ReadWrite`
   - `Files.Read`, `Files.ReadWrite`
4. Click "Add permissions".

### Client secret

1. Go to "Certificates & secrets" → "Client secrets".
2. Click "New client secret".
3. Add a description and select an expiration.
4. **Copy the VALUE** (not the Secret ID) — you'll put it in `.env.development` as `MCP_M365_CLIENT_SECRET`.

## Configuration

### Environment Variables

| Name | Required | Default | Purpose |
| --- | --- | --- | --- |
| `MCP_M365_CLIENT_ID` | yes | — | Azure App Registration "Application (client) ID". |
| `MCP_M365_CLIENT_SECRET` | yes | — | The client secret **VALUE** from "Certificates & secrets" (not the Secret ID). |
| `MCP_M365_TENANT_ID` | recommended | `common` | Directory (tenant) ID. ‡ |
| `MCP_M365_AUTHORITY_HOST` | no | [host][login-host] | OAuth authority host. Override for sovereign clouds (US Gov, China, etc.). |
| `MCP_M365_REDIRECT_URI` | no | `http://localhost:3333/auth/callback` | OAuth redirect URI. Must match the value registered in Azure. |
| `MCP_M365_AUTH_PORT` | no | `3333` | Port the auth server listens on. Must match the redirect URI port. |
| `MCP_M365_TOKEN_PATH` | no | `~/.local/state/ki/mcp-m365/oauth-tokens.json` | OAuth token location. |
| `XDG_STATE_HOME` | no | `$HOME/.local/state` | Absolute base directory for default OAuth and audit state paths. |
| `MCP_M365_SCOPES` | no | † | Space-separated OAuth scopes requested for the access token. |
| `MCP_M365_TOKEN_ENDPOINT` | no | § | Full token endpoint URL. Override only if your authority uses a non-standard path. |
| `MCP_M365_ACCESS_LEVEL` | no | `read` | Maximum tool access level to register. ¶ |
| `MCP_M365_AUDIT_LOG` | no | `writes` | Audit-log scope. ※ |
| `MCP_M365_AUDIT_LOG_PATH` | no | `~/.local/state/ki/mcp-m365/audit.jsonl` | Path to the JSONL audit log. |
| `MCP_M365_AUDIT_LOG_MAX_BYTES` | no | `10485760` (10 MiB) | Size-based rotation threshold in bytes. Set to `0` to disable rotation. |
| `MCP_M365_AUDIT_LOG_KEEP` | no | `5` | Number of rotated audit-log files to retain. |
| `MCP_M365_TRIAGE_TRACKING_PATH` | no | `<first root>/.mcp-m365/email-triage/tracking.json5` | Default location of the routing engine's tracking cache. Overridable per call; always root-checked. |
| `MCP_M365_TRIAGE_RULES_PATH` | no | — | Default path to the rule note. When set, the routing tools' `rules` argument becomes optional. Overridable per call; always root-checked. |
| `MCP_M365_TRIAGE_ROOTS` | no | — | `PATH`-style list of directories the routing engine may read and write. Every configured or caller-supplied path must resolve inside one of them. Unset disables all engine file access. |
| `NODE_ENV` | no | — | Dev convention. ‖ |

† Default scopes: `offline_access User.Read Mail.Read Mail.ReadWrite Mail.Send Calendars.Read Calendars.ReadWrite Files.Read Files.ReadWrite` (the canonical `M365_DEFAULT_SCOPES` list in [`src/config/index.ts`](./src/config/index.ts)). `offline_access` is required to receive a refresh token.

‡ Set explicitly for single-tenant apps to avoid `/common` endpoint errors.

§ Default: `${MCP_M365_AUTHORITY_HOST}/${MCP_M365_TENANT_ID}/oauth2/v2.0/token`.

¶ One of: `read` (default — 11 read-only tools, least privilege), `write` (adds 15 non-destructive mutations such as send-email, create-event, OneDrive upload — 26 tools total), `destructive` (adds 6 delete tools — all 32 tools registered). Levels nest. Each tool's level is derived from its MCP annotations (`readOnlyHint: true` → `read`; `destructiveHint: true` → `destructive`; explicit `readOnlyHint: false` AND `destructiveHint: false` → `write`; missing annotations → `destructive` fail-safe); a tool registers when its derived level ≤ the configured level. Unknown values abort startup.

‖ `ki:server:mcp:dev`/`ki:server:auth:dev`/`ki:server:mcp:inspect` set this to `development`. At startup [`src/config/index.ts`](./src/config/index.ts) hydrates `process.env` from the package root, highest precedence first: `.env.local`, then `.env.${NODE_ENV}` (when `NODE_ENV` is set), then `.env`. A var already in the environment (e.g. the Claude Desktop `env` block) always wins.

※ One of `off`, `writes` (record only non-read tool calls), `all` (record every invocation).

**Notes:**

- Always use the client secret **VALUE**, never the Secret ID.
- Set `MCP_M365_TENANT_ID` for single-tenant apps to avoid `/common` endpoint errors.
- Use `MCP_M365_CLIENT_ID` and `MCP_M365_CLIENT_SECRET` consistently across `.env.development` and the Claude Desktop config.

### Claude Desktop Configuration

Run `bun run build` first so `dist/mcp-server/index.js` exists, then add to your Claude Desktop config:

```json
{
  "mcpServers": {
    "mcp-m365": {
      "command": "node",
      "args": ["/path/to/mcp-m365/dist/mcp-server/index.js"],
      "env": {
        "MCP_M365_CLIENT_ID": "your-client-id",
        "MCP_M365_CLIENT_SECRET": "your-client-secret"
      }
    }
  }
}
```

A starter is in [`claude-config-sample.json`](./claude-config-sample.json).

### Running From Source (Dev)

```bash
cp .env.example .env.development
# edit .env.development with your Azure credentials, then:
bun run ki:server:mcp:dev    # MCP server
bun run ki:server:auth:dev   # OAuth server on :3333
```

The `ki:server:mcp:dev`, `ki:server:auth:dev`, and `ki:server:mcp:inspect` scripts run with `NODE_ENV=development`. At startup `loadConfig()` in [`src/config/index.ts`](./src/config/index.ts) hydrates `process.env` from the package root, highest precedence first: `.env.local`, then `.env.${NODE_ENV}` (when `NODE_ENV` is set — so `.env.development` here), then `.env` — so it picks up `.env.development` automatically (Bun also auto-loads these natively). A var already in the environment always wins, so under Claude Desktop (which does not set `NODE_ENV`) the `env` block in the config takes precedence over any `.env*` file.

## Authentication

The OAuth flow runs out-of-band via the standalone auth server:

1. Start the auth server: `bun run ki:server:auth:dev` (listens on `http://localhost:3333`).
2. In Claude, call the `m365_auth_start` tool — it returns a sign-in URL.
3. Open the URL, sign in, and grant the requested scopes.
4. Tokens (including a refresh token thanks to `offline_access`) are saved to `~/.local/state/ki/mcp-m365/oauth-tokens.json`.
5. The MCP server reads that file and refreshes tokens transparently when they expire.

To force re-authentication, delete `~/.local/state/ki/mcp-m365/oauth-tokens.json` and re-run the `m365_auth_start` tool.

## Development

```bash
bun run ki:server:mcp:dev     # bun --watch, MCP server (NODE_ENV=development)
bun run ki:server:auth:dev    # bun --watch, OAuth server (NODE_ENV=development)
bun run ki:server:mcp:start   # build then run MCP server from dist/ under node
bun run ki:server:auth:start  # build then run auth server from dist/ under node
bun run ki:server:mcp:inspect # MCP Inspector against TS source (NODE_ENV=development)
bun run test               # vitest (use `bun run test`, not `bun test`)
bun run ki:lint:types         # tsc --noEmit
bun run ki:lint:check         # Biome lint + format check
bun run ki:lint:fix           # Biome auto-fix (uses --unsafe)
ki repo audit --skill ki-authoring --repo .  # rumdl check for authored Markdown
```

## Security Model

- Secrets (`MCP_M365_CLIENT_SECRET`) come from env vars only; never committed. `.env*` files are gitignored except `.env*.example` templates.
- OAuth tokens live in `~/.local/state/ki/mcp-m365/oauth-tokens.json` (mode 0600 when written). The MCP server reads, refreshes, and rewrites this file but never logs token values.
- The auth server binds to `localhost:3333` only and accepts a single OAuth callback at a time; pending CSRF state entries expire after 10 minutes.
- Tool annotations honestly mark destructive operations (`m365_email_message_delete`, `m365_calendar_event_delete`, `m365_email_folder_delete`, `m365_onedrive_item_delete`, etc.) so MCP clients can prompt before invoking them.
- Every Graph API call goes through [`src/main/graph-client/index.ts`](./src/main/graph-client/index.ts), which centralises retries and 401 → token-refresh handling.

## Directory Structure

```text
├── claude-config-sample.json        # Example Claude Desktop config
├── package.json
├── tsconfig.json                    # Base TS config
├── tsconfig.build.json              # Build config (emits to dist/)
├── .env.example                     # Template for MCP_M365_* vars (copy to .env.development)
├── src/
│   ├── config/index.ts              # loadConfig(env?) → Config; no module-level env reads
│   ├── mcp-server/index.ts          # MCP server entry point
│   ├── auth-server/index.ts         # Standalone OAuth callback server (port 3333)
│   ├── main/                        # Implementation reusable outside the MCP server
│   │   ├── auth/index.ts            # Token persistence/refresh + createTokenStorage(cfg)
│   │   └── graph-client/index.ts    # Microsoft Graph HTTP layer (retries + refresh)
│   ├── tools/                       # Tool modules + aggregator
│   │   ├── index.ts                 # Central tools export
│   │   ├── auth/                    # OAuth tools (m365_auth_start / m365_auth_status)
│   │   ├── calendar/                # Calendar tools
│   │   ├── email/                   # Email tools
│   │   ├── folder/                  # Mail folder tools
│   │   ├── rules/                   # Inbox rules tools
│   │   └── onedrive/                # OneDrive tools
│   └── utils/
│       ├── access-level.ts          # Access-level gate (registers tools ≤ MCP_M365_ACCESS_LEVEL)
│       ├── annotations.ts           # MCP annotation presets
│       ├── audit-log.ts             # JSONL audit log + size-based rotation
│       ├── html-sanitizer.ts        # HTML body sanitisation
│       └── odata-helpers.ts         # OData query building
└── dist/                            # Build output (gitignored, created by `bun run build`)
```

`src/auth-server/` is the standalone OAuth callback server and its tests; `src/main/auth/` is the reusable token storage/refresh layer (the config-injected `createTokenStorage(cfg)` factory) consumed by both entry points. They're deliberately decoupled so the auth server can run independently of the MCP server. Both entry points call `loadConfig()` once at boot and thread the resulting `Config` into the access gate, token storage, and tool registration — nothing reads `process.env` at import time.

## Troubleshooting

**`Cannot find module`**

```bash
bun install
```

**`Port 3333 in use`**

```bash
bunx kill-port 3333
bun run ki:server:auth:dev
```

**`AADSTS7000215: Invalid client secret`**

Use the secret **VALUE** from "Certificates & secrets", not the Secret ID.

**`Authentication required`**

Delete `~/.local/state/ki/mcp-m365/oauth-tokens.json` and re-authenticate via the `m365_auth_start` tool.

## Extending the Server

1. Create a new module directory under [`src/tools/`](./src/tools/).
2. Implement tool handlers in separate `.ts` files; each handler validates inputs with a strict zod schema and sets honest MCP annotations.
3. Export a `register<Service>Tools(server)` function from the module's `index.ts`.
4. Re-export it from [`src/tools/index.ts`](./src/tools/index.ts).
5. Wire it into [`src/mcp-server/index.ts`](./src/mcp-server/index.ts) alongside the existing `register*Tools(...)` calls.

Route every Graph API call through [`src/main/graph-client/index.ts`](./src/main/graph-client/index.ts) so token refresh and error handling stay consistent.

[login-host]: https://login.microsoftonline.com
