---
id: MCP-M365-FND-001
title: Replace hand-rolled OAuth refresh with MSAL
theme: foundation-tooling
horizon: soon
status: open
blocks: []
blocked-by: []
baseline-ref: null
---

## Context

Replace the custom OAuth refresh implementation in `auth/index.ts` with `@azure/msal-node`, preserving the existing token-file shape and `ensureAuthenticated` call sites through a deliberate migration.

## Boundary

Keep the work limited to the stated surface.
