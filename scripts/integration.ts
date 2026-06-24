#!/usr/bin/env bun
/**
 * Integration script for mcp-m365 via the mcporter typed client.
 * Calls through the mcporter daemon (must be running).
 *
 * Record a session:  bun run test:record
 * Replay in CI:      bun run test:replay
 */

import { createHnrMcpM365Client } from "../src/generated/client.ts";

const client = await createHnrMcpM365Client();

try {
  const result = await client.m365_about({});
  console.log("m365_about:", JSON.stringify(result, null, 2));
  console.log("✓ integration passed");
} finally {
  await client.close();
}
