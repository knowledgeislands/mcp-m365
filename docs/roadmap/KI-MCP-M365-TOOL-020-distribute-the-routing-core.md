---
id: KI-MCP-M365-TOOL-020
area: TOOL
title: Distribute the routing core
kind: deliver
horizon: soon
status: draft
blocks: []
blocked_by: [KI-MCP-M365-TOOL-018]
baseline_ref: null
created_at: 2026-10-18T00:19:30Z
updated_at: 2026-10-18T00:19:30Z
---

## Goal

Another mail server can take an exact, verifiable revision of the routing core and know when its copy is out of date.

## Context

The [Gmail routing design](/Users/krisbrown/workspaces/humans-not-robots/hnr-principal/+/_THREADS/email-routing/2026-10-17-gmail-routing-design.md) task 3 proposes publishing a manifest of the core's source revision and SHA-256 digests for vendored consumers, following the `ki-repo-mcp` shared-code precedent that `mcp-m365` and `mcp-gsuite` already use for their access-gate code. Neither server is published to a package registry; both are Git source built locally.

## Boundary

How the core is distributed is still open (the ENGINE-HOME question): the design recommends a canonical copy here vendored with a manifest and drift check, against a separate repository consumed by a pinned Git reference, or a published package, which needs the owner's approval. This record does not presume the answer. Its deliverable is whatever the owner's answer requires on this side: a manifest in the shared-code format for vendoring, a tagged revision for a pinned reference, or nothing here if the core moves out. Plan it only after that answer.

Publishing to any package registry needs the owner's explicit approval and is outside this record.

## Shaping

- **Approach:** decided by the ENGINE-HOME answer; see Boundary.
- **Dependencies:** [KI-MCP-M365-TOOL-018](KI-MCP-M365-TOOL-018-extract-the-routing-core.md), so there is a core directory to distribute.
- **Open decisions:** ENGINE-HOME.
- **Promotion to Next:** ENGINE-HOME answered and TOOL-018 delivered.

## Discussion

### If vendored

Reuse the shared-code manifest format rather than a second one, and add the check that fails when the manifest is stale against the core directory.

### Verification

A consumer-side check reproduces the digests from a clean checkout of the named revision.

### Intake authority

Captured on 18 October 2026 under the deploying owner's CAPTURE-RECORDS answer, "Phases 0-1 only". The title is neutral where the design's "Publish the routing core manifest for vendored consumers" presumed vendoring. The horizon is the capturing agent's placement, not the owner's. Capture grants no priority, Ready transition, implementation, acceptance or publication authority.
