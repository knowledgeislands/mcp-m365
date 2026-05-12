# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

This file is maintained automatically by [release-please](https://github.com/googleapis/release-please) — entries below are generated from [Conventional Commits](https://www.conventionalcommits.org/) on `main`. Edit only when manually overriding release-please output.

## [Unreleased]

### Changed

- Migrated the MCP entry point from the low-level `Server` to the high-level `McpServer` (`@modelcontextprotocol/sdk/server/mcp.js`). Every tool now registers with a Zod input schema and explicit MCP tool annotations (`readOnlyHint` / `destructiveHint` / `idempotentHint` / `openWorldHint`). The custom `fallbackRequestHandler`, `withCommonResponseFormat`, and `applyResponseFormat` wrappers have been removed — the SDK now handles `initialize` / `tools/list` / `tools/call` directly.

### Removed

- The undocumented `responseFormat` parameter that the previous `Server` wiring injected into every tool's input schema, and the corresponding `{ type: '<tool>-response', success, request, text }` structured-content envelope it produced. Tools now return their handler's `content` array verbatim, matching the rest of the MCP ecosystem.

## [1.0.0] - 2026-05-09

### Added

- Initial release.
- Outlook tools: list/search/read/send/draft/mark-as-read/delete email; list/create/cancel/decline/delete events; list/create/rename/delete folders; move emails; list/create/edit-sequence rules.
- OneDrive tools: list, search, download, upload (small + chunked), share, create folder, delete.
- OAuth 2.0 authentication flow with token storage.

### Removed

- Power Automate / Flow API tools and configuration removed in favour of focusing on Outlook + OneDrive via Microsoft Graph.
