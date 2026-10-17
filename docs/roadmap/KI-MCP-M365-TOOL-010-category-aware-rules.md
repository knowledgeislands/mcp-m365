---
id: KI-MCP-M365-TOOL-010
area: TOOL
title: Category-aware rules
status: triage
blocks: [KI-MCP-M365-TOOL-012]
blocked_by: []
baseline_ref: null
created_at: 2026-10-17T13:59:45Z
updated_at: 2026-10-17T13:59:45Z
---

## Goal

Rules can test, remove and deliberately preserve Outlook categories, and lint catches a mistyped category name, so categories can safely mark mail that is awaiting confirmation.

## Context

The engine can already add a category with `tag:<name>`, but it cannot read one back: `categories` is not in `TRIAGE_SELECT_FIELDS`, and there is no predicate for it or action to remove it. That blocks the planned judgment tier, which files unclassified mail by AI judgment and marks it with a category until the owner confirms, corrects or a rule claims it. Three capabilities are needed:

- **Read and test.** Request `categories` with each message, carry it on `EmailRecord`, and add a negatable `category:<name>` predicate.
- **Remove and hold.** Add an `untag:<name>` action, and a no-op `hold` action that matches a message, applies nothing and reports it as held. `hold` lets an aged-pass line placed above the retention lines shield marked mail from ageing out.
- **Declare.** Add a ` ```categories v1 ` block to the rule note beside the destinations block, and have lint flag any `tag:`, `untag:` or `category:` name it does not declare, as it already does for `save-attachments:` destinations.

With placeholders, the shield and lapse lines the deploying owner plans to write look like this:

```rules
category:"Routed: judged" age:30d folder:"<disposal folder>" -> untag:"Routed: judged"
category:"Routed: judged" -> hold
```

## Boundary

Rule-language support and lint only. Do not create Outlook master categories: that needs `MailboxSettings.ReadWrite`, which is not in `M365_DEFAULT_SCOPES`, and creating them once by hand is cheaper than widening consent. Do not add an importance or subject-edit action. The judgment tools themselves belong to KI-MCP-M365-TOOL-011 and the re-check to KI-MCP-M365-TOOL-012.

## Discussion

### Purity

`category:` is a pure test over a field already fetched, so it belongs in `matcher.ts` with no I/O. `untag:` is applied in `graph-ops.ts` alongside `tag:`, by writing the message's category list without the named entry. `hold` is handled in the run layer so it stops evaluation for that message without counting as a mutation against `maxActions`.

### Case and spelling

Outlook category names are case-insensitive in the client but stored as written. Decide during planning whether `category:` compares case-insensitively; lint's declared-names check makes either choice safe.

### Verification

Parser, matcher and lint unit tests for each new element, including negation, an undeclared name, an `untag:` of an absent category (a no-op, not a failure), and `hold` reported in the result without a Graph call.

### Intake authority

Captured from an owner-approved rollout plan (phase 2, after KI-MCP-M365-TOOL-008 and KI-MCP-M365-TOOL-009). Capture grants no priority, Ready transition, implementation, acceptance or publication authority.
