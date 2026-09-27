---
id: MCP-M365-TOOL-006
area: TOOL
title: Add mailbox triage helpers
theme: tool-surface
horizon: future
status: draft
blocks: []
blocked_by: []
baseline_ref: null
created_at: 2026-07-29T00:37:05Z
updated_at: 2026-09-27T22:43:46Z
---

## Goal

Achieve the stated outcome: Add mailbox triage helpers.

## Context

Add mailbox triage helpers.

## Boundary

Keep the work limited to the stated surface.

## Discussion

No discussion recorded yet; this item is unshaped by design at the `future` horizon.

### Pickup checkpoint — 2026-09-27

At inspected local `main` `2e651e5f8b225be7a1d299e3a7f15ac5289ffe64`, verified source delivery under the broad stated goal: `af0dbd6eaceb4123218446ee76b14a2b3cccf5f5` added mailbox routing handlers in `src/main/triage/run.ts` and `src/main/triage/drift.ts`, registered `m365_email_routing_triage`, `m365_email_routing_aged`, `m365_email_routing_lint`, and `m365_email_routing_drift` in `src/tools/triage/index.ts`, and connected them through `src/mcp-server/index.ts`. The current README tool table and `docs/guides/user/email-routing.md` describe the caller surface. `2b4a1ece73f284ec6f92fafcabf6feb858602e4f` and `1b5e322246f58588ba6806de80ba852039dabfb6` later added a bounded, rule-driven PDF-saving action; that action is also relevant to `MCP-M365-TOOL-003` but does not deliver its general attachment tools. This record has no shaped acceptance criteria, implementation baseline, Review packet, or owner acceptance, so source delivery alone does not change its `future`/`draft` lifecycle. This audit's `bun run test` attempt was blocked by sandbox `EPERM` writing `node_modules/.vite-temp`; no fresh test, coverage, build, smoke, or live Graph result is claimed. Before any follow-on implementation or closure, reconcile the destination branch, linked tasks, and retained worktrees; define the remaining scope or confirm the broad goal against the delivered surface. This checkpoint is pickup guidance, not an execution block or authority grant; absent evidence does not release any owner or lift a hold. Closure requires independent review of the exact candidate, verification, and explicit owner acceptance, with the done record retained until an explicit prune selection.
