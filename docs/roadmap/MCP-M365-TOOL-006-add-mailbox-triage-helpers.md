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
updated_at: 2026-10-04T10:57:33Z
---

## Goal

Achieve the stated outcome: Add mailbox triage helpers.

## Context

Add mailbox triage helpers.

## Boundary

Keep the work limited to the stated surface.

## Shaping

Propose verification-only reconciliation of the existing four-tool routing delivery. Owner confirmation that this delivered surface satisfies the broad Goal is needed before readiness; no new routing behavior is implied. Preserve Future/Draft until selection and plan approval.

## Current state

Delivery commit `af0dbd6eaceb4123218446ee76b14a2b3cccf5f5` is an ancestor of reviewed `8d7d09d7e9a197b80250073902d794e50b0012f9`. The four routing tools are present and connected; later rule-driven PDF-saving changes are present too. A fixture-only suite on that reviewed revision passed 37 files and 1,135 tests. This is historical verification evidence, not a fresh claim about subsequent commits or a complete delivery gate.

### Existing behavior to reconcile

`m365_email_routing_triage` and `m365_email_routing_aged` default to report mode; explicit live mode permits mailbox mutations. Their action bound defaults to 50 and caps at 200. Lint is read-only. Drift is deliberately annotated `DESTRUCTIVE_ONESHOT_REMOTE`: it advances the local tracking sweep and can prune tracked history, so it is not a read-only scan. Preserve its batch/progress-to-zero contract. Rules remain caller-owned and reread, tracking and destination paths remain confined, and PDF saving remains bounded and rule-driven.

## Steps

- [ ] Confirm that the existing routing surface satisfies this item's Goal and approve a verification-only delivery boundary.
- [ ] Recheck historical commit ancestry, current primary checkout, and any linked task/worktree ownership before execution.
- [ ] Map each existing safety, batch, progress, schema, and tool-inventory criterion to implementation, fixtures, and guide evidence.
- [ ] Run complete gates against the immutable execution baseline, without live Graph operations or user tracking/rule files.
- [ ] Correct only demonstrated documentation inconsistencies; stop and replan if a behavior repair is needed.
- [ ] Produce a six-heading Review packet identifying delivered commits, fresh verification, limitations, and independent review.

## Files touched

This roadmap item, and only if demonstrated inconsistencies require it, README and `docs/guides/user/email-routing.md`. Source and fixture tests are evidence, not planned implementation edits.

## Verify

Run `bunx tsc --noEmit`, `bun run test`, `bun run test:coverage`, `bun run build`, `bun run ki:test:smoke`, and focused engineering, MCP, work, and roadmap audits sequentially. Inspect report-default assertions, drift sweep termination, access annotations, path containment, shared result schemas, registration inventory, and smoke behavior. No real mailbox mutations, provider calls, token changes, or caller rule/tracking files are permitted by this verification slice.

## Dependencies / blocks

No local build-order blocker is identified because the source already exists. Owner agreement on Goal coverage and current task/worktree reconciliation remain prerequisites; missing ownership evidence is not evidence of availability. Auth-recovery work is independently owned by MCP-M365-FND-006.

## Documentation impact

### Decision Records

No new architecture is proposed; this records and verifies existing delivery.

### Specifications

No new behavior is accepted; review existing annotations, bounds, result schemas, and progress guarantees against fixture evidence.

### Guides

Verify the existing email-routing guide, especially report defaults and drift's tracking mutation; amend only concrete inaccuracies.

### Roadmap

Keep this record and its Future/Draft state until selection and approval. Reconciliation must not fabricate extra implementation or infer acceptance from source presence.

## Discussion

### Pickup checkpoint — 2026-09-27

At inspected local `main` `2e651e5f8b225be7a1d299e3a7f15ac5289ffe64`, verified source delivery under the broad stated goal: `af0dbd6eaceb4123218446ee76b14a2b3cccf5f5` added mailbox routing handlers in `src/main/triage/run.ts` and `src/main/triage/drift.ts`, registered `m365_email_routing_triage`, `m365_email_routing_aged`, `m365_email_routing_lint`, and `m365_email_routing_drift` in `src/tools/triage/index.ts`, and connected them through `src/mcp-server/index.ts`. The current README tool table and `docs/guides/user/email-routing.md` describe the caller surface. `2b4a1ece73f284ec6f92fafcabf6feb858602e4f` and `1b5e322246f58588ba6806de80ba852039dabfb6` later added a bounded, rule-driven PDF-saving action; that action remains separate from the now-delivered general attachment tools. This record has no shaped acceptance criteria, implementation baseline, Review packet, or owner acceptance, so source delivery alone does not change its `future`/`draft` lifecycle. This audit's `bun run test` attempt was blocked by sandbox `EPERM` writing `node_modules/.vite-temp`; no fresh test, coverage, build, smoke, or live Graph result is claimed. Before any follow-on implementation or closure, reconcile the destination branch, linked tasks, and retained worktrees; define the remaining scope or confirm the broad goal against the delivered surface. This checkpoint is pickup guidance, not an execution block or authority grant; absent evidence does not release any owner or lift a hold. Closure requires independent review of the exact candidate, verification, and explicit owner acceptance, with the done record retained until an explicit prune selection.

### Readiness review

Four routing tools and their implementation/guide are present. Reconcile desired remaining behavior against that delivered surface before new implementation; do not fabricate work or infer acceptance from source presence.
