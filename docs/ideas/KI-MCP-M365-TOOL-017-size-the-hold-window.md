---
id: KI-MCP-M365-TOOL-017
area: TOOL
title: Size the hold window
kind: investigate
horizon: hold
hold:
  reason: waiting-for
  condition: until Kris resumes Humans not Robots work, when hnr.email-routing chooses a horizon afresh (EMAIL-OWNER, Kris, 20 October)
status: draft
blocks: []
blocked_by: []
baseline_ref: null
created_at: 2026-10-18T00:19:30Z
updated_at: 2026-10-19T23:24:19Z
---

> **Idea, not on the roadmap.** Learn from real mail whether held messages ever fill a folder's listing window, and size the window apart from the action cap if they do; Kris said size later, with the Humans Not Robots email-routing thread. Moved out of `docs/roadmap/` on 27 October 2026 under the roadmap sweep, with its record kept in full here so that it can return when Kris brings it back; it was `KI-MCP-M365-TOOL-017`.

## Goal

Know, from real mail, whether held messages ever fill a folder's listing window, and if they do, size the window apart from `maxActions` so the aged pass still reaches mail it can act on.

## Context

KI-MCP-M365-TOOL-010 added the `hold` action. Each folder is listed oldest first in a window one message larger than `maxActions`. Held mail does not count against `maxActions` but does take places in that window, so if more held mail than `maxActions` sits at the old end of a folder, the aged pass reports work remaining yet acts on nothing. The loop stops rather than spins, raising `maxActions` clears it, and a test pins the behaviour.

The deploying owner chose on 18 October 2026 to accept the limit and size the window separately later.

## Boundary

Measure first: per-folder held counts against the window over live aged runs. Change the listing contract only if the evidence shows the window fills. Leave `hold` semantics and the `maxActions` batch budget as they are.

## Hold

Held until a Project opens to own email routing (LANE-OWNERS, Kris, 19 October). Kris answered LANE-OWNERS a) on 19 October 2026: the email-routing draft records in mcp-m365 and mcp-gsuite wait in one hold until a Project opens to own them. The record was at `horizon: future` before the hold; release chooses a horizon afresh once that Project exists.

Re-validated on 20 October 2026 under TO-DONE: the hold stays. Kris answered EMAIL-OWNER on 20 October ("if that's all to do with H and R, it can go to the H and R area"), so the Project the condition waited for exists, [hnr.email-routing](/Users/krisbrown/workspaces/humans-not-robots/hnr-principal/+/_WORK/hnr.email-routing/work.md), and owns these records; that Project is itself paused until Kris resumes Humans not Robots work, which is now the release condition.

## Discussion

### Evidence

The run result already reports `held` with rule lines. Per-folder counts across several aged runs, or the run ledger [KI-MCP-M365-TOOL-014](KI-MCP-M365-TOOL-014-routing-run-ledger.md) proposes, would show whether held mail approaches the window.

### Options if it does

A separate listing size, paging past held mail until `maxActions` actionable messages are found, or a listing filter that excludes held categories at the provider. Paging keeps the contract simplest for callers; a filter is provider-specific and belongs in an adapter.

### Intake authority

Captured on 18 October 2026 from the deploying owner's HOLD-WINDOW answer, "Accept, size later". The horizon is the capturing agent's placement, not the owner's. Capture grants no priority, Ready transition, implementation, acceptance or publication authority.
