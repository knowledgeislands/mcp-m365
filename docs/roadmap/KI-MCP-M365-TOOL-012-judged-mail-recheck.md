---
id: KI-MCP-M365-TOOL-012
area: TOOL
title: Judged mail re-check
kind: deliver
horizon: soon
status: draft
blocks: []
blocked_by: [KI-MCP-M365-TOOL-010, KI-MCP-M365-TOOL-011]
baseline_ref: null
created_at: 2026-10-17T13:59:45Z
updated_at: 2026-10-17T14:02:35Z
---

## Goal

Every run can see where each judgment-filed message now stands, settle it once the owner has accepted, moved it or a rule has claimed it, and tell the owner's corrections of judgment apart from corrections of rules.

## Context

A judgment-filed message carries a category until something settles it. Its lifecycle, as the deploying owner has approved it:

- **pending**, then **seen**, then **confirmed**: the owner clears the category, or the message is seen read and unmoved on two runs at least three hours apart.
- **corrected**: the owner moves it elsewhere.
- **superseded**: a rule now matches it.
- **stale**: still pending after 14 days; listed, not acted on.

A new tool, `m365_email_routing_judged`, lists messages carrying a judgment category across the routing destination folders, joined with their tracking entries, and returns each one's state and whether a rule now matches. In live mode it removes the category from confirmed, corrected and superseded messages.

The drift pass (`drift.ts`) already detects messages moved after routing. It should report each correction's `route_kind`, and separate corrections of judged routes from corrections of rule routes, because the first feeds description amendments and the second feeds rule demotion.

## Boundary

State derivation, settlement and drift separation. Do not re-judge here: a message needing a new verdict is returned to the caller, which uses KI-MCP-M365-TOOL-011. Do not age or delete mail; retention stays in the aged pass. Graduation of judged patterns into rules is proposed by the caller from the evidence this returns, not written by the engine.

## Shaping

- **Approach.** A pure state-derivation function over tracking entries and current message state, with an injected clock, wrapped by one read-mostly tool that settles categories in live mode; drift gains a `route_kind` split.
- **Dependencies.** Builds on KI-MCP-M365-TOOL-010 (`category:`, `untag:`) and KI-MCP-M365-TOOL-011 (tracking fields, `route_kind`).
- **Decisions still needed.** The annotation preset, and whether drift separation ships here or waits for the pruning phase.
- **Promotion.** Moves to Next once KI-MCP-M365-TOOL-011 is delivered.

## Discussion

### Dependencies

This builds on the `category:` predicate and `untag:` action from KI-MCP-M365-TOOL-010 and on the tracking fields and `route_kind` from KI-MCP-M365-TOOL-011.

### Annotations

The tool mutates only categories, which converges on repeat, so `WRITE_IDEMPOTENT_REMOTE` is the likely preset, with report mode as the default. Confirm during planning.

### Verification

Fixture tests for each state transition, including the two-run seen rule with an injected clock, a message moved by the owner, a message now matched by a rule, and the 14-day stale threshold. Drift tests showing judged and rule corrections reported separately. Add the tool to `EXPECTED_TOOLS` in `scripts/smoke.ts`.

### Intake authority

Captured from an owner-approved rollout plan (phase 2 for the re-check, phase 4 for drift separation). Capture grants no priority, Ready transition, implementation, acceptance or publication authority. Adopted on 17 October 2026 under the deploying owner's approved rollout, which sets the horizons and names this record's place in the sequence; adoption grants no Ready transition, acceptance or publication authority.
