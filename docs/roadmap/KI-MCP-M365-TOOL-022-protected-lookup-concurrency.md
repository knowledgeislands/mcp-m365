---
id: KI-MCP-M365-TOOL-022
area: TOOL
title: Protected-list lookups within mailbox concurrency
priority: medium
size: s
assignee: work/ki.tools
status: triage
blocks: []
blocked_by: []
baseline_ref: null
created_at: 2026-11-28T01:56:00Z
updated_at: 2026-11-28T01:56:00Z
---

# KI-MCP-M365-TOOL-022: Protected-list lookups within mailbox concurrency

## Goal

The protected-list check before a write stays within Microsoft Graph's limit of 4 concurrent requests per mailbox, and a throttled Graph call waits out `Retry-After` rather than failing the write.

## Context

Wicket (cairn.harbour) moved 994 HNR messages on 28 November 2026, and Microsoft throttled the large batches; batches of four worked around it. In mcp-m365 0.10.0 (045a030), `findHits` in `src/main/protected/index.ts` reads each target message's folder and categories with `LOOKUP_CONCURRENCY = 5` (line 276) parallel `GET me/messages/{id}` calls through `mapLimit`, one more than Graph's 4 per mailbox. The guard runs before any message moves (`guardWrite` in `src/main/folder/move.ts`), and the move itself is sequential, so the lookups are where the concurrency comes from. `mapLimit` rests on `Promise.all`, so one throttled lookup rejects the whole guard. The Graph client in `src/main/graph-client/index.ts` has no 429 or `Retry-After` handling: anything other than a 2xx or a 401 rejects as `API call failed with status …`.

## Boundary

- **In:** lowering `LOOKUP_CONCURRENCY` to 4, or making it configurable with 4 as the default; honouring `Retry-After` on a 429 (and 503) in the Graph client, with a bounded number of retries, so the lookups and the writes behind them both benefit.
- **Out:** changing the guard's all-or-nothing semantics; batching through Graph's `$batch` endpoint, which is a separate design.

## Discussion

Proposed by Wicket. Whether a configurable value earns its keep over a fixed 4 is for planning. Captured as triage for Kris to adopt or cancel.
