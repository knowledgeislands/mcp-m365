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
import { initTokenStorage } from '../main/auth/index.js'
import { registerAuthTools, registerCalendarTools, registerEmailTools, registerFolderTools, registerOnedriveTools, registerRulesTools } from '../tools/index.js'
import { makeAccessGatedRegister } from '../utils/access-level.js'

const config = loadConfig()

console.error(`${config.serverName} starting...`)
console.error(`  SERVER_NAME=${config.serverName}`)
console.error(`  MCP_M365_ACCESS_LEVEL=${config.accessLevel}`)
console.error(`  MCP_M365_AUDIT_LOG=${config.auditLogMode}${config.auditLogMode === 'off' ? '' : ` (path: ${config.auditLogPath})`}`)

initTokenStorage(config)

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

registerAuthTools(server, config)
registerCalendarTools(server)
registerEmailTools(server)
registerFolderTools(server)
registerOnedriveTools(server)
registerRulesTools(server)

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
