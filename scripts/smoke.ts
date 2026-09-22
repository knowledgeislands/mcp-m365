#!/usr/bin/env node
// End-to-end smoke test: boot the built server over stdio MCP, list its tools,
// and assert the surface matches the expected set. Catches drift between code
// and the *wire* contract — per-handler tests cover in-process behavior; this
// covers the actual protocol round-trip.
//
// Run via `bun run test:smoke` (builds dist/ first). Runs in CI without secrets:
// the server boots without MCP_M365_CLIENT_ID / MCP_M365_CLIENT_SECRET — it just warns.
//
// This is the only place the 2026-07-28 protocol profile is proved live: the
// source audit deliberately does not require a local `server/discover` literal,
// because the SDK owns discovery and protocol stamping. So the assertions below
// carry that weight — modern era, negotiated revision, a complete discovery
// envelope, a real tools/call, argument rejection — plus a second client that
// opens in the legacy era, which proves the deliberate `legacy: 'serve'`
// fallback still serves the identical surface rather than assuming it does.

import { Client } from '@modelcontextprotocol/client'
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio'

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
  'm365_email_messages_search',
  'm365_email_routing_triage',
  'm365_email_routing_aged',
  'm365_email_routing_lint',
  'm365_email_routing_drift'
] as const

const die = (msg: string, detail?: unknown): never => {
  console.error(`✗ smoke failed: ${msg}`)
  if (detail !== undefined) console.error(detail)
  process.exit(1)
}

const createTransport = (): StdioClientTransport =>
  new StdioClientTransport({
    command: 'node',
    args: ['dist/mcp-server/index.js'],
    // Raise the access level so the smoke test sees the full surface; the
    // server's default (read only) would otherwise hide every mutating tool.
    env: { ...(process.env as Record<string, string>), MCP_M365_ACCESS_LEVEL: 'destructive' }
  })

const main = async (): Promise<void> => {
  // `versionNegotiation: 'auto'` lets the client open with server/discover, so
  // the era below is the server's choice rather than the client's assumption.
  const client = new Client(
    { name: 'mcp-m365-smoke', version: '0.0.0' },
    { capabilities: {}, versionNegotiation: { mode: 'auto' } }
  )

  await client.connect(createTransport())

  try {
    const discovery = client.getDiscoverResult()
    if (client.getProtocolEra() !== 'modern') die('server/discover did not select the modern protocol era')
    if (client.getNegotiatedProtocolVersion() !== '2026-07-28') {
      die('unexpected negotiated protocol version', client.getNegotiatedProtocolVersion())
    }
    if (
      discovery?.resultType !== 'complete' ||
      !discovery.supportedVersions.includes('2026-07-28') ||
      discovery._meta?.['io.modelcontextprotocol/serverInfo']?.name !== 'mcp-m365'
    ) {
      die('invalid server/discover result', discovery)
    }

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

    // `m365_about` is the only tool that reads neither the network nor a token
    // store, so it is the one round trip this test can make without secrets.
    // The v2 client validates the required wire-level resultType, then lifts a
    // complete result into the stable callTool return shape.
    const about = await client.callTool({ name: 'm365_about', arguments: {} })
    if (about.isError) die('tool call returned an error envelope', about)
    const aboutText = Array.isArray(about.content) ? about.content[0] : undefined
    if (aboutText?.type !== 'text' || !aboutText.text.includes('MCP M365 Server')) {
      die('unexpected m365_about result envelope', about)
    }

    // Every tool's input schema is `.strict()`, so an unknown argument must be
    // rejected in the result envelope rather than accepted or thrown as a
    // protocol error.
    const malformed = await client.callTool({ name: 'm365_about', arguments: { nonexistent: 1 } })
    if (!malformed.isError) die('malformed tool arguments were accepted', malformed)

    // Second connection, opened deliberately without version negotiation: the
    // retained `legacy: 'serve'` fallback must still serve the same surface.
    const legacyClient = new Client({ name: 'mcp-m365-legacy-smoke', version: '0.0.0' }, { capabilities: {} })
    await legacyClient.connect(createTransport())
    try {
      if (legacyClient.getProtocolEra() !== 'legacy') {
        die('legacy initialize fallback did not remain available', legacyClient.getProtocolEra())
      }
      if ((await legacyClient.listTools()).tools.length !== EXPECTED_TOOLS.length) {
        die('legacy tool surface differs from modern tool surface')
      }
    } finally {
      await legacyClient.close()
    }

    console.error(`✓ smoke passed: modern discovery, legacy fallback, ${names.length} tools, valid result envelope`)
  } finally {
    await client.close()
  }
}

main().catch((err) => die('uncaught', err))
