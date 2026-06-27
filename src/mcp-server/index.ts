#!/usr/bin/env node
/**
 * MCP M365 Server — main entry point.
 *
 * A Model Context Protocol server that provides access to Microsoft 365
 * services (Outlook, OneDrive) through the Microsoft Graph API.
 *
 * Uses the high-level `McpServer` from `@modelcontextprotocol/sdk` so each
 * tool is registered with a Zod input schema and tool annotations. Init,
 * tools/list, and tools/call are handled by the SDK.
 *
 * Config is loaded once here via `loadConfig()` and threaded into the access
 * gate, the shared token storage, and every tool-registration function — no
 * module reads `process.env` at import.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { loadConfig } from '../config/index.js'
import { createTokenStorage, makeEnsureAuthenticated } from '../main/auth/index.js'
import type { GraphContext } from '../main/graph-client/index.js'
import {
  registerAuthTools,
  registerCalendarTools,
  registerEmailTools,
  registerFolderTools,
  registerOnedriveTools,
  registerRulesTools
} from '../tools/index.js'
import { makeAccessGatedRegister } from '../utils/access-level.js'

const config = loadConfig()

console.error(`${config.serverName} starting...`)
console.error(`  SERVER_NAME=${config.serverName}`)
console.error(`  MCP_M365_ACCESS_LEVEL=${config.accessLevel}`)
console.error(`  MCP_M365_AUDIT_LOG=${config.auditLogMode}${config.auditLogMode === 'off' ? '' : ` (path: ${config.auditLogPath})`}`)

// Construct the token storage once here from the loaded config, then derive the
// auth gate and the GraphContext threaded into every Graph-calling tool group.
// No module reaches a shared singleton — config and its derivations are injected.
const tokenStorage = createTokenStorage(config)
const ctx: GraphContext = {
  graphApiEndpoint: config.graphApiEndpoint,
  ensureAuthenticated: makeEnsureAuthenticated(tokenStorage)
}

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

process.on('SIGTERM', () => {
  console.error('SIGTERM received but staying alive')
})

const main = async (): Promise<void> => {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error(`${config.serverName} ready`)
}

main().catch((error: Error) => {
  console.error(`Connection error: ${error.message}`)
  process.exit(1)
})
