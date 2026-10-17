---
id: KI-MCP-M365-TOOL-011
area: TOOL
title: Judgment verdict hook
status: triage
blocks: [KI-MCP-M365-TOOL-012]
blocked_by: []
baseline_ref: null
created_at: 2026-10-17T13:59:45Z
updated_at: 2026-10-17T13:59:45Z
---

## Goal

A caller that judges unclassified mail elsewhere can list what needs judging and hand verdicts back, and the engine files and records each verdict deterministically, without ever calling a model itself.

## Context

The routing design has two tiers: exact rules and thread-follow move mail with no mark, and AI judgment places only what reaches the fallback folder. The judgment runs in the caller, such as a scheduled agent task, against folder descriptions held in the knowledge base. The engine's part is to supply candidates and apply verdicts safely, and to keep enough evidence for judged patterns to graduate into rules later.

Two new tools, under `src/tools/triage/` with their logic in `src/main/triage/`:

- **`m365_email_routing_candidates`** lists messages in the fallback folder with the features judgment needs, and the folders of each message's conversation siblings.
- **`m365_email_routing_apply`** takes a verdict list, each with `folder`, `confidence` and `reason`. For each it re-resolves identity by subject, sender and received time, moves the message, adds the high- or low-confidence category, and writes a tracking entry. It runs in report mode by default and mutates only when the caller passes `dry_run: false`.

The tracking schema gains `route_kind` (`rule`, `thread` or `judged`), `confidence`, `reason`, `descriptions_version`, `judged_at`, `state`, `seen_at`, `rejudge_count` and `resolution`. Judged entries are exempt from the 21-day prune (`RETENTION_DAYS` in `drift.ts`) until resolved, and corrections are kept for 90 days, so graduation evidence and worked examples outlive the rolling window.

## Boundary

Candidate listing, verdict application and the tracking fields. No model call, prompt or folder description lives in this server. Verdicts naming an undeclared destination are rejected, as rule destinations are. The re-check of judged mail belongs to KI-MCP-M365-TOOL-012. Rule state stays with the caller: the server stores no verdicts beyond the tracking file the caller names.

## Discussion

### Annotations and access

`m365_email_routing_candidates` is `READ_ONLY_REMOTE`. `m365_email_routing_apply` moves and tags mail, so it is a write; whether it is `WRITE_REMOTE` or `DESTRUCTIVE_ONESHOT_REMOTE` depends on whether a verdict naming a disposal folder is allowed. Decide during planning, keep the annotation honest, and keep the batch bound (`maxActions` and `remaining`) that every routing pass uses.

### Paths

The tracking file is read and written only through `assertWithinRoots()`, as the existing passes do.

### Re-judging

A verdict that would move a message already judged once is not applied a second time; it is returned for the owner. The tracking `rejudge_count` carries this.

### Verification

Fixture tests for candidate listing with siblings, a verdict whose message has moved since listing, an undeclared destination, report versus live mode, the batch bound, and prune exemption of judged entries. Add both tools to `EXPECTED_TOOLS` in `scripts/smoke.ts`.

### Intake authority

Captured from an owner-approved rollout plan (phase 2). Capture grants no priority, Ready transition, implementation, acceptance or publication authority.
