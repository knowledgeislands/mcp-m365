# MCP M365 Server

[![CI](https://github.com/knowledgeislands/mcp-m365/actions/workflows/ci.yml/badge.svg)](https://github.com/knowledgeislands/mcp-m365/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@knowledgeislands/mcp-m365.svg)](https://www.npmjs.com/package/@knowledgeislands/mcp-m365)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

A comprehensive MCP (Model Context Protocol) server that connects Claude with Microsoft 365 services through the Microsoft Graph API.

## Supported Services

- **Outlook** - Email, calendar, folders, and rules
- **OneDrive** - Files, folders, search, and sharing

## Directory Structure

```text
├── claude-config-sample.json        # Example Claude Desktop config
├── package.json
├── tsconfig.json                    # Base TS config
├── tsconfig.build.json              # Build config (emits to dist/)
├── src/
│   ├── config.ts                    # Centralized configuration
│   ├── auth-server/
│   │   └── index.ts                 # Standalone OAuth server (port 3333)
│   ├── mcp-server/
│   │   └── index.ts                 # MCP server entry point
│   ├── tools/                       # Tool modules + aggregator
│   │   ├── index.ts                 # Central tools export
│   │   ├── auth/                    # Authentication modules
│   │   │   ├── index.ts
│   │   │   ├── token-manager.ts
│   │   │   ├── token-storage.ts
│   │   │   └── tools.ts
│   │   ├── calendar/                # Calendar functionality
│   │   ├── email/                   # Email functionality
│   │   ├── folder/                  # Folder functionality
│   │   ├── rules/                   # Email rules functionality
│   │   └── onedrive/                # OneDrive functionality
│   └── utils/                       # Shared utilities
│       ├── graph-api.ts             # Microsoft Graph API helper
│       ├── html-sanitizer.ts        # HTML body sanitization
│       └── odata-helpers.ts         # OData query building
└── dist/                            # Build output (gitignored, created by `npm run build`)
```

## Features

- **Authentication**: OAuth 2.0 authentication with Microsoft Graph API
- **Email Management**: List, search, read, send, and organize emails
- **Calendar Management**: List, create, accept, decline, and delete calendar events
- **OneDrive Integration**: List, search, upload, download, and share files
- **Modular Structure**: Clean separation of concerns for maintainability

## Response Format

- Tool responses are JSON-only.
- Every tool result includes `structuredContent` with machine-readable data.
- `content[0].text` contains the same payload serialized as pretty-printed JSON.
- `responseFormat` accepts only `json`.

## Available Tools

### Outlook (Email & Calendar)

| Tool                 | Description                                                             |
| -------------------- | ----------------------------------------------------------------------- |
| `list-emails`        | List recent emails from inbox, folder path, or explicit folder ID       |
| `search-emails`      | Search emails with filters in inbox, folder path, or explicit folder ID |
| `read-email`         | Read email content                                                      |
| `send-email`         | Send a new email                                                        |
| `draft-email`        | Save an email draft                                                     |
| `mark-as-read`       | Mark email as read/unread                                               |
| `delete-email`       | Move an email to Deleted Items (or hard delete with `permanent: true`)  |
| `list-events`        | List calendar events                                                    |
| `create-event`       | Create calendar event                                                   |
| `cancel-event`       | Cancel a calendar event                                                 |
| `decline-event`      | Decline event invitation                                                |
| `delete-event`       | Delete calendar event                                                   |
| `list-folders`       | List mail folders                                                       |
| `create-folder`      | Create mail folder                                                      |
| `rename-folder`      | Rename an existing mail folder                                          |
| `delete-folder`      | Delete a mail folder                                                    |
| `move-emails`        | Move emails between folders                                             |
| `list-rules`         | List inbox rules                                                        |
| `create-rule`        | Create inbox rule                                                       |
| `edit-rule-sequence` | Change the execution order of an existing inbox rule                    |

### Email Folder Targeting

For `list-emails` and `search-emails`, you can target mail folders in two ways:

- `folder`: well-known folder name (for example `inbox`) or full custom path (for example `Projects/2026/Q2`)
- `folderId`: explicit Microsoft Graph folder ID returned by `list-folders`

When both are provided, `folderId` takes precedence and is used directly.

Examples:

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

| Tool                     | Description              |
| ------------------------ | ------------------------ |
| `onedrive-list`          | List files in a path     |
| `onedrive-search`        | Search files by query    |
| `onedrive-download`      | Get download URL         |
| `onedrive-upload`        | Upload small file (<4MB) |
| `onedrive-upload-large`  | Chunked upload (>4MB)    |
| `onedrive-share`         | Create sharing link      |
| `onedrive-create-folder` | Create folder            |
| `onedrive-delete`        | Delete file or folder    |

## Quick Start

1. **Install dependencies**: `npm install`
2. **Azure setup**: Register app in Azure Portal (see detailed steps below)
3. **Configure environment**: Copy `.env.example` to `.env` and add your Azure credentials
4. **Configure Claude**: Update your Claude Desktop config with the server path
5. **Start auth server**: `npm run dev:auth`
6. **Authenticate**: Use the authenticate tool in Claude to get the OAuth URL
7. **Start using**: Access your M365 data through Claude!

## Installation

### Prerequisites

- Node.js 22.0.0 or higher
- npm
- Azure account for app registration

### Install Dependencies

```bash
npm install
```

## Azure App Registration & Configuration

### App Registration

1. Open [Azure Portal](https://portal.azure.com/)
2. Search for "App registrations"
3. Click "New registration"
4. Name: "MCP M365 Server"
5. Account type: "Accounts in any organizational directory and personal Microsoft accounts"
6. Redirect URI: Web → `http://localhost:3333/auth/callback`
7. Click "Register"
8. Copy the "Application (client) ID" for your `.env` file

### App Permissions

1. Go to "API permissions" under Manage
2. Click "Add a permission" → "Microsoft Graph" → "Delegated permissions"
3. Add these permissions:
   - `offline_access`
   - `User.Read`
   - `Mail.Read`, `Mail.ReadWrite`, `Mail.Send`
   - `Calendars.Read`, `Calendars.ReadWrite`
   - `Files.Read`, `Files.ReadWrite`
4. Click "Add permissions"

### Client Secret

1. Go to "Certificates & secrets" → "Client secrets"
2. Click "New client secret"
3. Add description and select expiration
4. **Copy the VALUE** (not the Secret ID)

## Configuration

### 1. Environment Variables

```bash
cp .env.example .env
```

Edit `.env`:

```bash
# Get these values from Azure Portal > App Registrations > Your App
M365_CLIENT_ID=your-application-client-id-here
M365_CLIENT_SECRET=your-client-secret-VALUE-here
M365_TENANT_ID=your-tenant-id-here
```

**Important Notes:**

- Use `M365_CLIENT_ID` and `M365_CLIENT_SECRET` everywhere (`.env` and Claude Desktop config alike).
- Set `M365_TENANT_ID` for single-tenant apps to avoid `/common` endpoint errors
- Always use the client secret **VALUE**, never the Secret ID

### 2. Claude Desktop Configuration

Add to your Claude Desktop config (run `npm run build` first to populate `dist/`):

```json
{
  "mcpServers": {
    "mcp-m365": {
      "command": "node",
      "args": ["/path/to/mcp-m365/dist/mcp-server/index.js"],
      "env": {
        "M365_CLIENT_ID": "your-client-id",
        "M365_CLIENT_SECRET": "your-client-secret"
      }
    }
  }
}
```

## Authentication

### Graph API (Outlook + OneDrive)

1. Start auth server: `npm run dev:auth`
2. Use the `authenticate` tool in Claude
3. Visit the provided URL and sign in
4. Tokens saved to `~/.mcp-m365-tokens.json`

## Troubleshooting

### Common Issues

**"Cannot find module"**

```bash
npm install
```

**"Port 3333 in use"**

```bash
npx kill-port 3333
npm run dev:auth
```

**"Invalid client secret" (AADSTS7000215)**

- Use the secret **VALUE**, not the Secret ID

**"Authentication required"**

- Delete `~/.mcp-m365-tokens.json` and re-authenticate

## Development

```bash
npm run dev:mcp        # tsx watch mode (MCP server)
npm run dev:auth       # tsx watch mode (OAuth server)
npm run start:mcp      # build then run MCP server from dist/
npm run start:auth     # build then run auth server from dist/
npm run inspect        # MCP Inspector against TS source
npm test               # vitest
npm run typecheck      # tsc --noEmit
npm run lint:check     # Biome lint + format check
npm run lint:fix       # Biome auto-fix (uses --unsafe)
npm run lint:md        # prettier + markdownlint for *.md
```

## Extending the Server

1. Create new module directory under `src/tools/`
2. Implement tool handlers in separate `.ts` files
3. Export the tools array from the module's `index.ts`
4. Re-export the new module tools from `src/tools/index.ts`
5. Wire the new tools array into the combined `TOOLS` list in `src/mcp-server/index.ts`

## Codebase Structure and Separation

- **/src/auth-server/**: Contains all authentication server code and its tests. This includes the standalone OAuth server and any related logic for handling authentication callbacks, token exchange, and secure token storage.
- **/src/tools/auth/**: Contains only authentication tool logic and utilities used by the MCP tool layer. No server code or server-specific tests are present here.

This separation ensures that server logic and tool logic are cleanly decoupled, making the codebase easier to maintain and extend.
