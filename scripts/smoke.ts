#!/usr/bin/env node
// End-to-end smoke test: boot the built server over stdio MCP, list its tools,
// and assert the surface matches the expected set. Catches drift between code
// and the *wire* contract — per-handler tests cover in-process behavior; this
// covers the actual protocol round-trip.
//
// Run via `bun run test:smoke` (builds dist/ first). Runs in CI without secrets:
// the server boots without MCP_M365_CLIENT_ID / MCP_M365_CLIENT_SECRET — it just warns.

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

// Single source of truth for the tool surface. If you add a tool in
// `src/tools/<group>/index.ts`, update this list.
const EXPECTED_TOOLS = [
  'm365_calendar_event_accept',
  'm365_auth_start',
  'm365_calendar_event_cancel',
  'm365_calendar_event_create',
  'm365_email_folder_create',
  'm365_email_rule_create',
  'm365_calendar_event_decline',
  'm365_email_message_delete',
  'm365_calendar_event_delete',
  'm365_email_folder_delete',
  'm365_email_draft_create',
  'm365_email_rules_reorder',
  'm365_email_message_mark_read',
  'm365_email_messages_move',
  'm365_onedrive_folder_create',
  'm365_onedrive_item_delete',
  'm365_onedrive_item_share',
  'm365_onedrive_item_upload',
  'm365_onedrive_item_upload_large',
  'm365_email_folder_rename',
  'm365_email_message_send',
  'm365_about',
  'm365_auth_status',
  'm365_email_messages_list',
  'm365_calendar_events_list',
  'm365_email_folders_list',
  'm365_email_rules_list',
  'm365_onedrive_item_download',
  'm365_onedrive_items_list',
  'm365_onedrive_items_search',
  'm365_email_message_get',
  'm365_email_messages_search'
] as const

const die = (msg: string, detail?: unknown): never => {
  console.error(`✗ smoke failed: ${msg}`)
  if (detail !== undefined) console.error(detail)
  process.exit(1)
}

const main = async (): Promise<void> => {
  const transport = new StdioClientTransport({
    command: 'node',
    args: ['dist/mcp-server/index.js'],
    env: { ...(process.env as Record<string, string>), MCP_M365_ROLES: 'read,write' }
  })
  const client = new Client({ name: 'mcp-m365-smoke', version: '0.0.0' }, { capabilities: {} })

  await client.connect(transport)

  try {
    const { tools } = await client.listTools()
    const names = tools.map((t) => t.name).sort()
    const expected = [...EXPECTED_TOOLS].sort()

    const missing = expected.filter((n) => !names.includes(n))
    const extra = names.filter((n) => !expected.includes(n as (typeof EXPECTED_TOOLS)[number]))
    if (missing.length || extra.length) {
      die('tool surface mismatch', { missing, extra, actualCount: names.length, expectedCount: expected.length })
    }

    const missingSchema = tools.filter((t) => !t.inputSchema || typeof t.inputSchema !== 'object').map((t) => t.name)
    if (missingSchema.length) die('tools missing inputSchema', missingSchema)

    console.error(`✓ smoke passed: ${names.length} tools listed, all schemas present`)
  } finally {
    await client.close()
  }
}

main().catch((err) => die('uncaught', err))
