# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

Two ways to run the server:

- **From source (fast iteration, tsx watch)**: `dev:mcp`, `dev:auth`
- **From compiled `dist/` (what Claude Desktop runs)**: `start:mcp`, `start:auth` (each auto-rebuilds via `prestart:*`)

Scripts:

- `npm install` - **ALWAYS run first** to install dependencies
- `npm run dev:mcp` - Run the MCP server from TS source in tsx watch mode
- `npm run dev:auth` - Run the OAuth authentication server on port 3333 in tsx watch mode (**required for authentication**)
- `npm run start:mcp` - Build and run the MCP server from compiled `dist/`
- `npm run start:auth` - Build and run the auth server from compiled `dist/`
- `npm run build` - Compile TS to JS in `dist/` (uses `tsconfig.build.json`, excludes tests)
- `npm run typecheck` - Type-check without emitting (`tsc --noEmit`)
- `npm run inspect` - Use MCP Inspector to test the server interactively (runs TS via tsx)
- `npm test` - Run vitest tests (use `npm run test:watch` for watch mode)
- `npm run lint:check` - Lint and format-check TS/JS/JSON with Biome
- `npm run lint:fix` - Auto-fix Biome lint findings (with `--unsafe`) and apply formatting
- `npm run format` - Apply Biome formatting only (no lint)
- `npm run lint:md` - Format and lint markdown files (prettier + markdownlint; Biome doesn't format markdown yet)
- `npm run lint:package` - Format `package.json` with syncpack
- `npm run lint:deps:missing` - Add missing dependencies detected by depcheck
- `npm run lint:deps:unused` - Remove unused devDependencies detected by depcheck
- `npm run update:libs` - Check for outdated packages with npm-check-updates
- `npx kill-port 3333` - Kill process using port 3333 if auth server won't start

## Architecture Overview

This is a modular MCP (Model Context Protocol) server that provides Claude with access to Microsoft 365 services:

- **Outlook** - Email, calendar, folders, rules
- **OneDrive** - Files, folders, sharing

### Core Structure

The codebase is TypeScript. Source lives under `src/`; compiled JS is emitted to `dist/` (flat layout: `dist/config.js`, `dist/mcp-server/index.js`, etc.) by `npm run build`. Module mode is CommonJS (TS `import`/`export` compiled to `require`/`module.exports`).

- `src/config.ts` - Centralized configuration (API endpoints, scopes, field selections)
- `src/mcp-server/index.ts` - Main entry point that combines all module tools and handles MCP protocol
- `src/auth-server/index.ts` - Standalone OAuth server for authentication flow

### Modules

Each tool module exports a `registerXxxTools(server)` helper that wires its tools onto an `McpServer` (with Zod input schemas and proper MCP tool annotations) and re-exports its handlers for tests:

- `auth/` - OAuth 2.0 authentication with token management; `registerAuthTools`
- `calendar/` - Calendar operations (list, create, cancel, decline, delete events); `registerCalendarTools`
- `email/` - Email management (list, search, read, send, draft, mark-as-read, delete); `registerEmailTools`
- `folder/` - Folder operations (list, create, rename, delete, move-emails); `registerFolderTools`
- `onedrive/` - OneDrive operations (list, search, download, upload, share, folder ops); `registerOnedriveTools`
- `rules/` - Email rules management; `registerRulesTools`
- `utils/` - Shared utilities including Graph API client and OData helpers

### Key Components

- **MCP wiring**: `src/mcp-server/index.ts` constructs `McpServer` and calls each module's `registerXxxTools`. Initialize / `tools/list` / `tools/call` are handled by the SDK — there is no custom `fallbackRequestHandler`.
- **Token Management**: Tokens stored in `~/.mcp-m365-tokens.json`
- **Graph API Client**: `src/utils/graph-api.ts` handles Microsoft Graph API calls (Outlook, OneDrive)

## Authentication

### Graph API (Outlook + OneDrive)

1. Azure app registration required with permissions:
   - `Mail.Read`, `Mail.ReadWrite`, `Mail.Send`
   - `Calendars.Read`, `Calendars.ReadWrite`
   - `Files.Read`, `Files.ReadWrite`
   - `User.Read`, `offline_access`
2. Start auth server: `npm run dev:auth` (or `npm run start:auth` for the compiled build)
3. Use authenticate tool to get OAuth URL
4. Complete browser authentication
5. Tokens automatically stored and refreshed

## Configuration

### Environment Variables

- Use `M365_CLIENT_ID` and `M365_CLIENT_SECRET` (in `.env.development` for local dev or Claude Desktop config in production). See the README for the full list of optional `M365_*` overrides.
- **Important**: Always use the client secret VALUE from Azure, not the Secret ID.

### Config Constants

- `GRAPH_API_ENDPOINT`: `https://graph.microsoft.com/v1.0/`
- `ONEDRIVE_UPLOAD_THRESHOLD`: 4 MB (files larger need chunked upload)
- Default page size: 50, max results: 1000

## Common Setup Issues

1. **Missing dependencies**: Run `npm install` first.
2. **Wrong secret**: Use the Azure client secret VALUE, not the Secret ID (`AADSTS7000215` error).
3. **Auth server not running**: Start `npm run dev:auth` before invoking the `authenticate` tool.
4. **Port conflicts**: `npx kill-port 3333` if the OAuth port is in use.

## Error Handling

- Graph API auth failures: "UNAUTHORIZED" error
- API errors include status codes and response details
- Token expiration triggers re-authentication flow
- Empty API responses handled gracefully
