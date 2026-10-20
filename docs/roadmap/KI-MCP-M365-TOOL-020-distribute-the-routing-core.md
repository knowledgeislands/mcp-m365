---
id: KI-MCP-M365-TOOL-020
area: TOOL
title: Distribute the routing core
kind: deliver
status: cancelled
resolution: merged
resolution_target: KI-MCP-M365-TOOL-018
blocks: []
blocked_by: []
baseline_ref: null
created_at: 2026-10-18T00:19:30Z
updated_at: 2026-10-20T04:29:10Z
---

## Goal

Another mail server can take an exact, verifiable revision of the routing core and know when its copy is out of date.

## Context

The [Gmail routing design](/Users/krisbrown/workspaces/humans-not-robots/hnr-principal/+/_WORK/hnr.email-routing/design/2026-10-17-gmail-routing-design.md) task 3 proposes publishing a manifest of the core's source revision and SHA-256 digests for vendored consumers, following the `ki-repo-mcp` shared-code precedent that `mcp-m365` and `mcp-gsuite` already use for their access-gate code. Neither server is published to a package registry; both are Git source built locally.

## Boundary

The core is distributed by vendoring (ENGINE-HOME, answered 18 October 2026): the canonical copy stays in this repository's provider-free core directory, and `mcp-gsuite` takes a byte-identical copy. This record's deliverable is the source side: a manifest of the core's source revision and per-file SHA-256 digests in the `ki-repo-mcp` shared-code format, and a check here that fails when the manifest is stale against the core directory. The consumer side, the vendored copy and its drift check, is [KI-MCP-GSUITE-TOOL-008](/Users/krisbrown/workspaces/knowledge-islands/mcp-gsuite/docs/roadmap/KI-MCP-GSUITE-TOOL-008-consume-the-routing-core.md). No separate repository or pinned Git reference is created; that waits until a third provider appears.

Publishing to any package registry needs the owner's explicit approval and is outside this record.

## Shaping

- **Approach:** generate the manifest from the core directory in the shared-code format, add a stale-manifest check to the gates, and name the revision consumers vendor from.
- **Dependencies:** [KI-MCP-M365-TOOL-018](KI-MCP-M365-TOOL-018-extract-the-routing-core.md), so there is a core directory to distribute.
- **Open decisions:** none.
- **Promotion to Next:** TOOL-018 delivered.

## Hold

Held until a Project opens to own email routing (LANE-OWNERS, Kris, 19 October). Kris answered LANE-OWNERS a) on 19 October 2026: the email-routing draft records in mcp-m365 and mcp-gsuite wait in one hold until a Project opens to own them. The record was at `horizon: soon` before the hold; release chooses a horizon afresh once that Project exists.

Re-validated on 20 October 2026 under TO-DONE: the hold stays. Kris answered EMAIL-OWNER on 20 October ("if that's all to do with H and R, it can go to the H and R area"), so the Project the condition waited for exists, [hnr.email-routing](/Users/krisbrown/workspaces/humans-not-robots/hnr-principal/+/_WORK/hnr.email-routing/work.md), and owns these records; that Project is itself paused until Kris resumes Humans not Robots work, which is now the release condition.

## Cancelled

Approved by Kris on 20 October 2026 under SWEEP-MERGE a), recorded in Knowledge Islands Principal `+/_WORK/ki.ways-of-working/decisions.md` (05:20 BST): "I agree with sweep merge". Merged into [KI-MCP-M365-TOOL-018](KI-MCP-M365-TOOL-018-extract-the-routing-core.md), `mcp-m365/docs/roadmap/KI-MCP-M365-TOOL-018-extract-the-routing-core.md`: extracting the core and publishing its manifest are tasks 1 and 3 of one Gmail routing design, and this record was already blocked by TOOL-018. TOOL-018 now carries this record's goal, boundary, approach, verification and vendoring decision; nothing is left outstanding here.

## Discussion

### Vendoring

Reuse the shared-code manifest format rather than a second one, and add the check that fails when the manifest is stale against the core directory.

### Verification

A consumer-side check reproduces the digests from a clean checkout of the named revision.

### Engine home

The owner answered ENGINE-HOME with option a) on 18 October 2026 (Decision 21 in the email-routing thread's [decisions](/Users/krisbrown/workspaces/humans-not-robots/hnr-principal/+/_WORK/hnr.email-routing/decisions.md)): canonical engine in `mcp-m365` in a provider-free directory behind a provider port, vendored into `mcp-gsuite` with a SHA-256 manifest and a drift check. The alternatives, a separate repository consumed by a pinned Git reference and a published package, were not chosen.

### Intake authority

Captured on 18 October 2026 under the deploying owner's CAPTURE-RECORDS answer, "Phases 0-1 only". The title is neutral where the design's "Publish the routing core manifest for vendored consumers" presumed vendoring. The horizon is the capturing agent's placement, not the owner's. Capture grants no priority, Ready transition, implementation, acceptance or publication authority.
