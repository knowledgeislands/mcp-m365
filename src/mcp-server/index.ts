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
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import config from '../config.js'
import { registerAuthTools, registerCalendarTools, registerEmailTools, registerFolderTools, registerOnedriveTools, registerRulesTools } from '../tools/index.js'
import { makeAuditedRegister } from '../utils/audit-log.js'

console.error(`${config.SERVER_NAME} starting...`)
console.error(`  SERVER_NAME=${config.SERVER_NAME}`)
console.error(`  MCP_M365_AUDIT_LOG=${config.AUDIT_LOG_MODE}${config.AUDIT_LOG_MODE === 'off' ? '' : ` (path: ${config.AUDIT_LOG_PATH})`}`)

const server = new McpServer({
  name: config.SERVER_NAME,
  version: config.SERVER_VERSION
})
server.registerTool = makeAuditedRegister(server)

registerAuthTools(server)
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
  console.error(`${config.SERVER_NAME} ready`)
}

main().catch((error: Error) => {
  console.error(`Connection error: ${error.message}`)
  process.exit(1)
})
