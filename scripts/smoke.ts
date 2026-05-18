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
  'about',
  'accept-event',
  'authenticate',
  'cancel-event',
  'check-auth-status',
  'create-event',
  'create-folder',
  'create-rule',
  'decline-event',
  'delete-email',
  'delete-event',
  'delete-folder',
  'draft-email',
  'edit-rule-sequence',
  'list-emails',
  'list-events',
  'list-folders',
  'list-rules',
  'mark-as-read',
  'move-emails',
  'onedrive-create-folder',
  'onedrive-delete',
  'onedrive-download',
  'onedrive-list',
  'onedrive-search',
  'onedrive-share',
  'onedrive-upload',
  'onedrive-upload-large',
  'read-email',
  'rename-folder',
  'search-emails',
  'send-email'
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
    env: { ...(process.env as Record<string, string>) }
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
