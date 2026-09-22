#!/usr/bin/env node
/**
 * MCP M365 Server — main entry point.
 *
 * A Model Context Protocol server that provides access to Microsoft 365
 * services (Outlook, OneDrive) through the Microsoft Graph API.
 *
 * Uses the high-level `McpServer` from `@modelcontextprotocol/server` (the
 * modern 2026-07-28 profile) so each tool is registered with a Zod input schema
 * and tool annotations. Discovery, protocol stamping, tools/list, and
 * tools/call are handled by the SDK.
 *
 * The stdio boundary is `serveStdio`, which owns the era decision for each
 * connection: the opening exchange selects modern or legacy, and exactly one
 * instance from `createServer` is pinned for that connection's lifetime.
 * `legacy: 'serve'` is deliberate — a 2025-era client still gets the identical
 * tool surface while the fleet migrates.
 *
 * Config is loaded once here via `loadConfig()` and threaded into the access
 * gate, the shared token storage, and every tool-registration function — no
 * module reads `process.env` at import.
 */
import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { loadConfig } from '../config/index.js'
import { makePdftotextExtractor } from '../main/attachments/pdf-text.js'
import { makeAttachmentSaver } from '../main/attachments/save.js'
import { createTokenStorage, makeEnsureAuthenticated } from '../main/auth/index.js'
import type { GraphContext } from '../main/graph-client/index.js'
import type { TriageContext } from '../main/triage/index.js'
import {
  registerAuthTools,
  registerCalendarTools,
  registerEmailTools,
  registerFolderTools,
  registerOnedriveTools,
  registerRulesTools,
  registerTriageTools
} from '../tools/index.js'
import { makeAccessGatedRegister } from '../utils/access-level.js'

const config = loadConfig()

console.error(`${config.serverName} starting...`)
console.error(`  SERVER_NAME=${config.serverName}`)
console.error(`  MCP_M365_ACCESS_LEVEL=${config.accessLevel}`)
console.error(
  `  MCP_M365_AUDIT_LOG=${config.auditLogMode}${config.auditLogMode === 'off' ? '' : ` (path: ${config.auditLogPath})`}`
)
// Print the engine's filesystem surface at boot, so a mistyped root or tracking
// path is visible in the server log rather than at 06:00 in a scheduled run.
console.error(`  MCP_M365_TRIAGE_ROOTS=${config.triageRoots.join(', ') || '(none — engine file access disabled)'}`)
console.error(`  MCP_M365_TRIAGE_TRACKING_PATH=${config.triageTrackingPath || '(unset)'}`)
console.error(`  MCP_M365_TRIAGE_RULES_PATH=${config.triageRulesPath || '(unset)'}`)
console.error(
  `  MCP_M365_ATTACHMENT_ROOTS=${config.attachmentRoots.join(', ') || '(none — save-attachments disabled)'}`
)

// Construct the token storage once here from the loaded config, then derive the
// auth gate and the GraphContext threaded into every Graph-calling tool group.
// No module reaches a shared singleton — config and its derivations are injected.
const tokenStorage = createTokenStorage(config)
const ctx: GraphContext = {
  graphApiEndpoint: config.graphApiEndpoint,
  ensureAuthenticated: makeEnsureAuthenticated(tokenStorage)
}
// The routing engine additionally owns a tracking cache; its location is
// configuration, never a tool parameter.
// It also carries out `save-attachments:`, which writes outside the knowledge
// base — so the saver gets its own roots rather than borrowing the engine's.
// Which destinations exist is not the server's business: the rule note declares
// them, and the roots bound what it may declare.
const triageCtx: TriageContext = {
  ...ctx,
  roots: config.triageRoots,
  trackingPath: config.triageTrackingPath,
  rulesPath: config.triageRulesPath,
  attachmentRoots: config.attachmentRoots,
  saveAttachments: makeAttachmentSaver(ctx, {
    roots: config.attachmentRoots,
    extractPdfText: makePdftotextExtractor(config.pdftotextPath)
  })
}

/**
 * Per-connection server factory. `serveStdio` calls this once the opening
 * exchange has chosen an era, so the instance — and the access gate and tool
 * registrations wrapped around it — belong to that connection rather than to
 * the process. The same factory serves both eras; nothing here branches on the
 * protocol revision.
 *
 * The long-lived, expensive state (config, token storage, the Graph and triage
 * contexts) stays at module scope above: it is connection-independent, and
 * rebuilding the token storage per connection would fragment the refresh path.
 */
const createServer = (): McpServer => {
  const server = new McpServer({
    name: config.serverName,
    version: config.serverVersion
  })
  server.registerTool = makeAccessGatedRegister(server, config.accessLevel, {
    mode: config.auditLogMode,
    path: config.auditLogPath,
    maxBytes: config.auditLogMaxBytes,
    keep: config.auditLogKeep
  })

  registerAuthTools(server, config, tokenStorage)
  registerCalendarTools(server, ctx)
  registerEmailTools(server, ctx)
  registerFolderTools(server, ctx)
  registerOnedriveTools(server, ctx)
  registerRulesTools(server, ctx)
  registerTriageTools(server, triageCtx)
  return server
}

const handle = serveStdio(createServer, {
  legacy: 'serve',
  onerror: (error) => console.error(`${config.serverName} stdio error:`, error)
})

console.error(`${config.serverName} ready`)

process.on('SIGTERM', () => {
  console.error('SIGTERM received but staying alive')
})

process.on('SIGINT', async () => {
  await handle.close()
  process.exit(0)
})
