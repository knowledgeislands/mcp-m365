---
id: MCP-M365-FND-006
area: FND
title: Expose reachable auth recovery
theme: foundation-tooling
horizon: triage
status: draft
blocks: []
blocked_by: []
baseline_ref: null
transferred_from: KI-ARCADIA-ECO-004
created_at: 2026-10-04T10:40:30Z
updated_at: 2026-10-04T10:40:30Z
---

## Goal

A caller whose Microsoft 365 authentication fails can follow the recovery instructions available at its configured access level, including the default read tier.

## Context

[Arcadia's reconciled MCP findings](../../../ki-arcadia-principal/Streams/Roadmap/KI-ARCADIA-ECO-004-route-deferred-mcp-findings.md) reproduced a synthetic 401 whose recovery hint names `m365_auth_start`, although that tool is absent at default read access. Fresh owner-source review confirms that `src/utils/results.ts` describes the authentication hint, `src/tools/auth/index.ts` annotates `m365_auth_start` as `WRITE_REMOTE`, and the authentication guide already explains the browser route and the write-tier requirement. The tool error therefore directs a read-tier caller to an unavailable tool without supplying that reachable alternative.

The existing MSAL migration item, MCP-M365-FND-001, owns token/cache implementation and compatibility, not recovery guidance at the tool error boundary. No retained roadmap or trade record owns this focused outcome.

## Boundary

Capture recovery guidance and its access-tier reachability only. Preserve the truthful write annotation for token-persisting authentication, the default read tier, token redaction, and existing browser consent boundaries. Do not migrate token storage, widen permissions automatically, perform live OAuth or Graph operations, or include package-badge maintenance.

## Discussion

### Reachable recovery

A later plan should make authentication failures explain the browser sign-in route with the callback server running, and explain that the authentication tool requires write access and a server restart when changing the tier. Use configured callback information rather than inventing a universal deployment address. Decide whether the error helper receives the needed configuration or points to a stable operator guide; preserve thin tool registration and configuration injection.

### Verification boundary

Use synthetic authentication failures and access-gated registration fixtures to prove that the read tier omits `m365_auth_start` yet exposes actionable recovery guidance. Verify write-tier tool recovery remains accurate and no token values or client secrets appear. No live account, token store, browser consent, or provider call is required.

### Intake authority

This is unadopted Triage from Arcadia's verified routing evidence. It grants no priority, Ready transition, implementation, acceptance, or publication authority. The receiving repository retains those decisions.
