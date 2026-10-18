---
id: KI-MCP-M365-TOOL-018
area: TOOL
title: Extract the routing core
kind: deliver
horizon: soon
status: draft
blocks: [KI-MCP-M365-TOOL-020]
blocked_by: []
baseline_ref: null
created_at: 2026-10-18T00:19:30Z
updated_at: 2026-10-18T00:19:30Z
---

## Goal

The routing engine's provider-free parts sit together behind a small provider port, so a second mail provider can reuse them without carrying Graph code, and Outlook routing behaves exactly as before.

## Context

The [Gmail routing design](/Users/krisbrown/workspaces/humans-not-robots/hnr-principal/+/_THREADS/email-routing/2026-10-17-gmail-routing-design.md) finds the engine about 80% mailbox-neutral already: `parser.ts`, `matcher.ts`, `lint.ts`, `folders.ts` and `lookups.ts` are pure, and the provider-free parts of `run.ts`, `tracking.ts` and `drift.ts` can join them. The Graph-specific layer is thin: `graph-ops.ts`, `message.ts` and `utils/kql.ts`. This is the design's phase 0 work in this repository, its task 1.

The port the design proposes: list messages in a location, look up a message, list a thread, search Sent, report the owner, apply a planned action and list attachments. Two engine changes make it clean: a neutral `calendarMethod` on `EmailRecord` in place of Outlook's `messageClass` and `@odata.type`, with Gmail's invitation subject prefixes added to the fallback; and a configurable triage root in place of the `_TRIAGE` constant, with the adapter supplying the message identity key.

## Boundary

A refactor with no behaviour change: every existing test and the replay fixture pass unchanged, and scheduled routing runs as before. Land it between scheduled runs, and only once the deploying owner's first-phase shadow runs are under way.

Where the canonical core finally lives, and how another server consumes it, is still open (the ENGINE-HOME question). This record does not presume the answer: it gathers the core into one provider-free directory behind the port, which every option needs, and leaves its final location and distribution to [KI-MCP-M365-TOOL-020](KI-MCP-M365-TOOL-020-distribute-the-routing-core.md).

## Shaping

- **Approach:** gather the pure modules and the provider-free parts of the run, tracking and drift layers into one provider-free directory; define the port; add `calendarMethod` and the configurable triage root; keep the Graph adapter thin.
- **Dependencies:** the deploying owner's first-phase shadow runs under way; [KI-MCP-M365-TOOL-010](KI-MCP-M365-TOOL-010-category-aware-rules.md) accepted, so its changes are not rebased across the move.
- **Open decisions:** ENGINE-HOME, for the core's final location only.
- **Promotion to Next:** the dependencies above hold, and a quiet window between scheduled runs is chosen.

## Discussion

### Port shape

Keep the port to the seven calls above and let each adapter own its provider's identity, search syntax and action mapping. Graph keeps subject, sender and received time as identity because moves reissue ids.

### Verification

Full gates; replay against the example rule fixture; an import check that nothing in the core directory reaches Graph, the network or the clock.

### Intake authority

Captured on 18 October 2026 under the deploying owner's CAPTURE-RECORDS answer, "Phases 0-1 only", which asked for design tasks 1-5, 8 and 9 as drafts. The horizon is the capturing agent's placement, not the owner's. Capture grants no priority, Ready transition, implementation, acceptance or publication authority.
