# mcp-m365

[![CI](https://github.com/knowledgeislands/mcp-m365/actions/workflows/ci.yml/badge.svg)](https://github.com/knowledgeislands/mcp-m365/actions/workflows/ci.yml) [![npm version](https://img.shields.io/npm/v/@knowledgeislands/mcp-m365.svg)](https://www.npmjs.com/package/@knowledgeislands/mcp-m365) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

An MCP (Model Context Protocol) server that connects Claude with Microsoft 365 services — Outlook (email, calendar, folders, rules) and OneDrive (files, search, sharing) — through the Microsoft Graph API.

## Features

- **OAuth 2.0** — standalone auth server handles the user consent flow; tokens are cached locally and refreshed transparently.
- **Outlook coverage** — read/search/send/delete email, manage folders + rules, create/accept/decline/cancel calendar events.
- **OneDrive coverage** — list/search/download/upload (with chunked >4 MB upload), create folders, share files.
- **Strict input schemas** — every tool registers a Zod schema with `.strict()`, so `tools/list` reports proper JSON Schema and tool annotations.
- **Modular structure** — service modules under `src/tools/<service>/` keep email, calendar, folder, rules, and OneDrive logic isolated.

**Quality:** 387 tests; ~95% line / ~97% function coverage, with all destructive paths covered.

## Available Tools

Tool results follow the standard MCP shape (`{ content: [{ type: 'text', text: '…' }] }`) and carry honest annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`).

### Outlook (Email & Calendar)

| Tool | Description |
| --- | --- |
| `list-emails` | List recent emails from inbox, folder path, or explicit folder ID. |
| `search-emails` | Search emails by query and/or date range (`receivedAfter`/`receivedBefore`), in inbox, folder path, or explicit folder ID. |
| `read-email` | Read email content. |
| `send-email` | Send a new email. |
| `draft-email` | Save an email draft. |
| `mark-as-read` | Mark email as read/unread. |
| `delete-email` | Move an email to Deleted Items (or hard delete with `permanent: true`). |
| `list-events` | List calendar events. |
| `create-event` | Create calendar event. |
| `accept-event` | Accept event invitation. |
| `decline-event` | Decline event invitation. |
| `cancel-event` | Cancel a calendar event. |
| `delete-event` | Delete calendar event. |
| `list-folders` | List mail folders. |
| `create-folder` | Create mail folder. |
| `rename-folder` | Rename an existing mail folder. |
| `delete-folder` | Delete a mail folder. |
| `move-emails` | Move emails between folders. |
| `list-rules` | List inbox rules. |
| `create-rule` | Create inbox rule. |
| `edit-rule-sequence` | Change the execution order of an existing inbox rule. |

#### Email folder targeting

For `list-emails` and `search-emails` you can target mail folders in two ways:

- `folder` — well-known folder name (for example `inbox`) or full custom path (for example `Projects/2026/Q2`).
- `folderId` — explicit Microsoft Graph folder ID returned by `list-folders`.

When both are provided, `folderId` takes precedence and is used directly.

```json
{
  "name": "list-emails",
  "arguments": {
    "folderId": "AAMkAGVmMDEz...",
    "count": 25,
    "includeCount": true
  }
}
```

```json
{
  "name": "search-emails",
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

| Tool                     | Description                |
| ------------------------ | -------------------------- |
| `onedrive-list`          | List files in a path.      |
| `onedrive-search`        | Search files by query.     |
| `onedrive-download`      | Get download URL.          |
| `onedrive-upload`        | Upload small file (<4 MB). |
| `onedrive-upload-large`  | Chunked upload (>4 MB).    |
| `onedrive-share`         | Create sharing link.       |
| `onedrive-create-folder` | Create folder.             |
| `onedrive-delete`        | Delete file or folder.     |

## Quick Start

1. **Install dependencies**: `bun install`.
2. **Register an Azure app** — see [Azure App Registration](#azure-app-registration).
3. **Configure environment** — copy `.env.example` to `.env.development` and add your Azure credentials.
4. **Build**: `bun run build`.
5. **Configure Claude Desktop** with `dist/mcp-server/index.js` and your `MCP_M365_CLIENT_ID`/`MCP_M365_CLIENT_SECRET` (see [Configuration](#configuration)).
6. **Start the auth server**: `bun run server:auth:dev` (separate process; handles OAuth on `localhost:3333`).
7. **Authenticate** — use the `authenticate` tool in Claude, follow the URL, sign in. Tokens are saved to `~/.mcp-m365-tokens.json`.

## Example Conversations

Concrete asks you might make of Claude with this server connected.

**Triage by sender and date range:**

> "Find unread emails from `finance@acme.com` received after 2026-04-01 and read the most recent one."

Claude calls [`search-emails`](#outlook-email--calendar) with `query: "finance@acme.com"`, `unreadOnly: true`, `receivedAfter: "2026-04-01T00:00:00Z"`, then `read-email` on the top result. Both honour mail-folder scoping (`folder` name or explicit `folderId`).

**Draft a reply to a meeting:**

> "Find Alice's invite for tomorrow's planning sync and draft a reply confirming I'll be there."

Claude uses `search-emails` + `read-email` to locate the invite, then [`draft-email`](#outlook-email--calendar) to save the response in your Drafts folder. (Sending an email goes through `send-email` — the server exposes both; calendar invites can be accepted directly via [`accept-event`](#outlook-email--calendar).)

**Upload a file to OneDrive:**

> "Upload `~/Documents/Q2-report.pdf` to OneDrive under `Projects/2026/Q2`. The folder doesn't exist yet — create it."

Claude calls [`onedrive-create-folder`](#onedrive) for the missing path, then [`onedrive-upload`](#onedrive) for the file (or [`onedrive-upload-large`](#onedrive) if it's over 4 MB; the chunked upload handles arbitrary sizes).

**Review the week's calendar:**

> "Show me my calendar for next week and accept the marketing review invite if it's still open."

Claude calls [`list-events`](#outlook-email--calendar) with the appropriate date range, finds the marketing review by subject, and runs [`accept-event`](#outlook-email--calendar) to send the acceptance.

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
| `MCP_M365_TENANT_ID` | recommended | `common` | Directory (tenant) ID. Set explicitly for single-tenant apps to avoid `/common` endpoint errors. |
| `MCP_M365_AUTHORITY_HOST` | no | `https://login.microsoftonline.com` | OAuth authority host. Override for sovereign clouds (US Gov, China, etc.). |
| `MCP_M365_REDIRECT_URI` | no | `http://localhost:3333/auth/callback` | OAuth redirect URI. Must match the value registered in Azure. |
| `MCP_M365_SCOPES` | no | `offline_access User.Read Mail.Read` | Space-separated OAuth scopes requested for the access token. |
| `MCP_M365_TOKEN_ENDPOINT` | no | `${MCP_M365_AUTHORITY_HOST}/${MCP_M365_TENANT_ID}/oauth2/v2.0/token` | Full token endpoint URL. Override only if your authority uses a non-standard path. |
| `NODE_ENV` | no | — | Dev convention. `server:mcp:dev`/`server:auth:dev`/`server:mcp:inspect` set this to `development`, which makes [`src/config.ts`](./src/config.ts) load `.env.development` from the CWD. Unset under Claude Desktop, so `.env*` files are ignored in production. |

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
bun run server:mcp:dev    # MCP server
bun run server:auth:dev   # OAuth server on :3333
```

The `server:mcp:dev`, `server:auth:dev`, and `server:mcp:inspect` scripts run with `NODE_ENV=development`, and [`src/config.ts`](./src/config.ts) calls `process.loadEnvFile('./.env.${NODE_ENV}')` at startup — so it picks up `.env.development` from the CWD automatically (Bun also auto-loads `.env.development` natively). Claude Desktop does not set `NODE_ENV`, so the file is ignored in production; env vars must come from the Claude Desktop config `env` block.

## Authentication

The OAuth flow runs out-of-band via the standalone auth server:

1. Start the auth server: `bun run server:auth:dev` (listens on `http://localhost:3333`).
2. In Claude, call the `authenticate` tool — it returns a sign-in URL.
3. Open the URL, sign in, and grant the requested scopes.
4. Tokens (including a refresh token thanks to `offline_access`) are saved to `~/.mcp-m365-tokens.json`.
5. The MCP server reads that file and refreshes tokens transparently when they expire.

To force re-authentication, delete `~/.mcp-m365-tokens.json` and re-run the `authenticate` tool.

## Development

```bash
bun run server:mcp:dev     # bun --watch, MCP server (NODE_ENV=development)
bun run server:auth:dev    # bun --watch, OAuth server (NODE_ENV=development)
bun run server:mcp:start   # build then run MCP server from dist/ under node
bun run server:auth:start  # build then run auth server from dist/ under node
bun run server:mcp:inspect # MCP Inspector against TS source (NODE_ENV=development)
bun run test               # vitest (use `bun run test`, not `bun test`)
bun run lint:types         # tsc --noEmit
bun run lint:check         # Biome lint + format check
bun run lint:fix           # Biome auto-fix (uses --unsafe)
bun run lint:md            # prettier + markdownlint for *.md
```

## Security Model

- Secrets (`MCP_M365_CLIENT_SECRET`) come from env vars only; never committed. `.env*` files are gitignored except `.env*.example` templates.
- OAuth tokens live in `~/.mcp-m365-tokens.json` (mode 0600 when written). The MCP server reads, refreshes, and rewrites this file but never logs token values.
- The auth server binds to `localhost:3333` only and accepts a single OAuth callback at a time; pending CSRF state entries expire after 10 minutes.
- Tool annotations honestly mark destructive operations (`delete-email`, `delete-event`, `delete-folder`, `onedrive-delete`, etc.) so MCP clients can prompt before invoking them.
- Every Graph API call goes through [`src/utils/graph-api.ts`](./src/utils/graph-api.ts), which centralises retries and 401 → token-refresh handling.

## Directory Structure

```text
├── claude-config-sample.json        # Example Claude Desktop config
├── package.json
├── tsconfig.json                    # Base TS config
├── tsconfig.build.json              # Build config (emits to dist/)
├── .env.example                     # Template for M365_* vars (copy to .env.development)
├── src/
│   ├── config.ts                    # Centralised configuration + .env.development loader
│   ├── auth-server/index.ts         # Standalone OAuth server (port 3333)
│   ├── mcp-server/index.ts          # MCP server entry point
│   ├── tools/                       # Tool modules + aggregator
│   │   ├── index.ts                 # Central tools export
│   │   ├── auth/                    # OAuth tools + token manager/storage
│   │   ├── calendar/                # Calendar tools
│   │   ├── email/                   # Email tools
│   │   ├── folder/                  # Mail folder tools
│   │   ├── rules/                   # Inbox rules tools
│   │   └── onedrive/                # OneDrive tools
│   └── utils/
│       ├── graph-api.ts             # Microsoft Graph API helper (retries + refresh)
│       ├── html-sanitizer.ts        # HTML body sanitisation
│       └── odata-helpers.ts         # OData query building
└── dist/                            # Build output (gitignored, created by `bun run build`)
```

`src/auth-server/` is the standalone OAuth server and its tests. `src/tools/auth/` is the tool-layer counterpart — token storage/refresh utilities consumed by the MCP server. They're deliberately decoupled so the auth server can run independently of the MCP server.

## Troubleshooting

**`Cannot find module`**

```bash
bun install
```

**`Port 3333 in use`**

```bash
bunx kill-port 3333
bun run server:auth:dev
```

**`AADSTS7000215: Invalid client secret`**

Use the secret **VALUE** from "Certificates & secrets", not the Secret ID.

**`Authentication required`**

Delete `~/.mcp-m365-tokens.json` and re-authenticate via the `authenticate` tool.

## Extending the Server

1. Create a new module directory under [`src/tools/`](./src/tools/).
2. Implement tool handlers in separate `.ts` files; each handler validates inputs with a strict zod schema and sets honest MCP annotations.
3. Export a `register<Service>Tools(server)` function from the module's `index.ts`.
4. Re-export it from [`src/tools/index.ts`](./src/tools/index.ts).
5. Wire it into [`src/mcp-server/index.ts`](./src/mcp-server/index.ts) alongside the existing `register*Tools(...)` calls.

Route every Graph API call through [`src/utils/graph-api.ts`](./src/utils/graph-api.ts) so token refresh and error handling stay consistent.
