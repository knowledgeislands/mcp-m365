---
id: KI-MCP-M365-TOOL-014
area: TOOL
title: Routing run ledger
kind: deliver
horizon: hold
hold:
  reason: waiting-for
  condition: until Kris resumes Humans not Robots work, when hnr.email-routing chooses a horizon afresh (EMAIL-OWNER, Kris, 20 October)
status: draft
blocks: []
blocked_by: []
baseline_ref: null
created_at: 2026-10-17T13:59:45Z
updated_at: 2026-10-19T23:24:19Z
---

> **Idea, not on the roadmap.** Leave one validated summary record per routing run in an append-only ledger, so the owner can see what every run did and notice when runs stop; rollout phase 4, held with the Humans Not Robots email-routing thread. Moved out of `docs/roadmap/` on 27 October 2026 under the roadmap sweep, with its record kept in full here so that it can return when Kris brings it back; it was `KI-MCP-M365-TOOL-014`.

## Goal

Each routing run leaves one validated summary record in an append-only ledger, so a dashboard or the owner can see what every run did and notice when runs stop.

## Context

A scheduled routing task calls several passes in turn and writes a summary for the owner. Today that summary has no fixed schema and no durable home, so a stalled schedule goes unnoticed until someone looks: in one deployment, runs stopped for several days before anyone saw it.

The proposal is a tool, `m365_email_routing_summary_append`, that validates a record against an `email-routing.run/v1` schema and appends it to `runs.jsonl` beside the caller's tracking file. Each pass result also carries a `runId`, so the summary can cite the passes it covers.

The schema the deploying owner has approved includes, among its fields, a `needs_you` list (items for the owner to decide, such as an ambiguous forward match from KI-MCP-M365-TOOL-009), routing counts including `forward_matched`, aged counts that report matched pairs apart from age-based archives, and `hours_since_last_run`.

## Boundary

Validation and append only. The ledger path goes through `assertWithinRoots()`; the tool never rewrites or truncates earlier lines. Rendering, notification and dashboards are the caller's concern.

## Hold

Held until a Project opens to own email routing (LANE-OWNERS, Kris, 19 October). Kris answered LANE-OWNERS a) on 19 October 2026: the email-routing draft records in mcp-m365 and mcp-gsuite wait in one hold until a Project opens to own them. The record was at `horizon: future` before the hold; release chooses a horizon afresh once that Project exists.

Re-validated on 20 October 2026 under TO-DONE: the hold stays. Kris answered EMAIL-OWNER on 20 October ("if that's all to do with H and R, it can go to the H and R area"), so the Project the condition waited for exists, [hnr.email-routing](/Users/krisbrown/workspaces/humans-not-robots/hnr-principal/+/_WORK/hnr.email-routing/work.md), and owns these records; that Project is itself paused until Kris resumes Humans not Robots work, which is now the release condition.

## Discussion

### Schema ownership

The schema should live in `src/main/triage/` as a Zod schema, `.strict()` with bounded numerics, so the tool's `inputSchema` and the validator are the same object. Version it in the record (`schema: "email-routing.run/v1"`) so later fields do not break earlier readers.

### Concurrency

Two runs appending at once must not interleave partial lines. Use a single `appendFile` of one complete line, or the shared lock the tracking writer uses.

### Verification

Tests for a valid append, rejection of an invalid record with nothing written, a path outside the roots, and two concurrent appends producing two whole lines. Add the tool to `EXPECTED_TOOLS` in `scripts/smoke.ts`.

### Intake authority

Captured from an owner-approved rollout plan (phase 4). Capture grants no priority, Ready transition, implementation, acceptance or publication authority. Adopted on 17 October 2026 under the deploying owner's approved rollout, which sets the horizons and names this record's place in the sequence; adoption grants no Ready transition, acceptance or publication authority.
