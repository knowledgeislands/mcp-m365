# Roadmap

## Recently Completed

- Date-range email search filters
- Folder rename
- Folder delete

## Next Up

- Tentatively accept calendar invites
- Reply / reply-all
- Forward email
- Email attachment download and send-with-attachments
- Save draft reply / draft forward

## Future Advanced Capabilities

- Find free/busy or scheduling helper
- Mailbox triage helpers

## Tooling

- Migrate markdown formatting from prettier to Biome once Biome ships stable markdown support (currently keeping prettier + markdownlint for `.md` because Biome 2.x doesn't format markdown yet).
- Ratchet test coverage upward. Current baseline thresholds in `vitest.config.ts` are 30% lines / 20% branches (matching today's actual coverage). Each new tool handler should ship with tests that mock `callGraphAPI`/`callGraphAPIPaginated`; tighten thresholds in lockstep until 70%+ lines is reached.
- Migrate from low-level `Server` (`@modelcontextprotocol/sdk/server/index.js`) to high-level `McpServer` (`@modelcontextprotocol/sdk/server/mcp.js`), matching `mcp-kb` and `mcp-local-agent-mode-sessions`. This is a substantial refactor: every tool's `inputSchema` would move from raw JSON Schema to Zod (60+ tools), and the custom `withCommonResponseFormat` / `applyResponseFormat` wrappers would need to be reimplemented per-tool or dropped. The `fallbackRequestHandler` and pinned `2025-11-25` protocol version would be removed in favour of the SDK defaults. Wire-level response shape changes — verify no client depends on the current `{ type: '<tool>-response', success, request, text }` structured-content shape before starting.
