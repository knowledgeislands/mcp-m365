---
id: KI-MCP-M365-TOOL-015
area: TOOL
title: Deduplicate saved attachments
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

## Goal

The `save-attachments:` action saves each distinct document once, so the same receipt arriving on several messages does not pile up as numbered copies in the destination folder.

## Context

In one deployment the same receipt was saved three times, as the original file and `-2` and `-3` copies. The saver in `src/main/attachments/save.ts` names each file from the message date, vendor, amount and document kind, then calls `deconflict()` in `naming.ts`, which appends `-2`, `-3` and so on whenever the name is already taken. Its rollback prevents duplicates from a partly failed message, but nothing recognises that a file with the same content already exists. The same document therefore lands again whenever it reaches a harvesting rule on another message: a forwarded copy, a reply quoting it, a re-send, or the original and its forward both passing through harvesting folders (see KI-MCP-M365-TOOL-009).

## Boundary

Duplicate detection in the saver only. Do not change naming, the destinations model, the roots boundary or the per-attachment size limit. Do not delete existing duplicates on disk; cleaning those up is a one-off owner task. Two genuinely different documents that compose the same name must still both be saved, under `deconflict()`'s numbered names.

## Shaping

- **Approach.** Hash each fetched attachment before naming it and skip the write when the destination already holds identical bytes, reporting the skip on `SavedFile`.
- **Dependencies.** None in build order. It matters most once KI-MCP-M365-TOOL-009 archives matched pairs, since both sides of a pair may pass through harvesting folders.
- **Decisions still needed.** Hash the stem-sharing files only, or keep a hash index beside the destination.
- **Promotion.** Moves to Next when selected after KI-MCP-M365-TOOL-008 and KI-MCP-M365-TOOL-009, or sooner if duplicate receipts recur.

## Hold

Held until a Project opens to own email routing (LANE-OWNERS, Kris, 19 October). Kris answered LANE-OWNERS a) on 19 October 2026: the email-routing draft records in mcp-m365 and mcp-gsuite wait in one hold until a Project opens to own them. The record was at `horizon: soon` before the hold; release chooses a horizon afresh once that Project exists.

Re-validated on 20 October 2026 under TO-DONE: the hold stays. Kris answered EMAIL-OWNER on 20 October ("if that's all to do with H and R, it can go to the H and R area"), so the Project the condition waited for exists, [hnr.email-routing](/Users/krisbrown/workspaces/humans-not-robots/hnr-principal/+/_WORK/hnr.email-routing/work.md), and owns these records; that Project is itself paused until Kris resumes Humans not Robots work, which is now the release condition.

## Discussion

### Detection

Hash each fetched attachment (SHA-256) before naming it, and skip the write when a file in the destination already has the same hash. Hashing every file in a large destination on every call is wasteful; options are hashing only files whose name shares the composed stem, or keeping a small hash index beside the destination within the same roots. Decide during planning.

### Reporting

A skipped duplicate is a success, not a failure, so the rule's `move:` still runs. `SavedFile` should report it, for example `written: false` with a `duplicate_of` filename, so the run result shows why nothing was written.

### Verification

Tests for the same bytes arriving on two messages (one file written), the same bytes in one message twice, different bytes with the same composed name (both saved, numbered), and an existing on-disk duplicate from an earlier run.

### Intake authority

Captured on the deploying owner's decision to record a receipt deduplication fix as mcp-m365 work. Capture grants no priority, Ready transition, implementation, acceptance or publication authority. Adopted on 17 October 2026 under the deploying owner's approved rollout, which sets the horizons and names this record's place in the sequence; adoption grants no Ready transition, acceptance or publication authority.
