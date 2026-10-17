---
id: KI-MCP-M365-TOOL-009
area: TOOL
title: Forwarded-to predicate
status: triage
blocks: []
blocked_by: []
baseline_ref: null
created_at: 2026-10-17T13:59:45Z
updated_at: 2026-10-17T13:59:45Z
---

## Goal

A rule can recognise that the mailbox owner has already forwarded a message to a given address, so an item held until it is handed on is archived once, and only once, it has been.

## Context

A common filing pattern holds payment documents the mailbox owner must deal with personally in one folder until they forward each one to a processing address, such as a finance mailbox. Today the engine can only age such a folder out on a timer, which archives unresolved items blind. The deploying owner has stopped that timer and asked for this predicate first, alongside KI-MCP-M365-TOOL-008.

The forward is observable. When the owner forwards a message to a shared address they also receive, the forwarded copy arrives back in the same mailbox, so both the original and the forward are readable by the engine.

The proposed predicate reads like any other aged-pass line. With placeholders:

```rules
folder:"<held folder>" forwarded-to:"finance@example.com" !status:flagged -> save-attachments:receipts, move:"<archive folder>", mark:read
```

`forwarded-to:<address>` is true for a message when a forward copy exists that meets every one of these:

- it was sent by the mailbox owner (for example <kris@kris.me.uk>) to `<address>`;
- its subject is `FW:` or `Fwd:` followed by the original's subject, compared after normalising prefixes, case and whitespace;
- it was received after the original and within 90 days of it;
- when both messages carry attachments, they share at least one attachment file name.

Outlook also records the last action taken on the original as the MAPI extended property `PidTagLastVerbExecuted` (`0x1081`), where 104 means forwarded. Not every client sets it, so it corroborates a match and never establishes one alone. Its availability through Graph needs checking during planning.

## Boundary

The predicate and its match reporting only. Ambiguous matches are reported, never applied: with two or more candidate forwards nothing moves. Do not send, forward or modify the forward copy; it follows whatever rule its own folder carries. Do not add a timer-based fallback archive; listing an unmatched item after a period is the caller's reporting concern, not engine policy.

## Discussion

### Outcomes the result must report

- **One match.** The predicate is true and the rule's actions run on the original.
- **Two or more candidates.** The predicate is false, and the result lists the message as an ambiguous forward match for the owner to decide.
- **No match.** The predicate is false; nothing is reported by the engine.

The run result should count matched pairs separately from age-based archives, so the caller can tell the two apart.

### Saving the attachment once

The forward copy usually carries the same attachment as the original. If both the original's rule and the forward copy's rule harvest attachments, the same document is saved twice. KI-MCP-M365-TOOL-015 owns content-level deduplication in the saver; this record should still state, in its documentation, that only one side of a pair needs `save-attachments:`.

### Purity and lookup

The search for forward copies is Graph I/O. As with thread-follow, resolve it in the run layer before the pure matcher, cache per call, and keep `parser.ts`, `matcher.ts` and `lint.ts` free of I/O. A search by recipient, sender and normalised subject within the date window is the expected query shape; the planner should confirm Graph's `$search` or `$filter` support for each term.

### Verification

Fixture tests for one match, two candidates, a forward outside the window, a forward with no shared attachment name, a forward to a different address, and a subject that differs only by prefix and case. The deploying owner's acceptance test is that a replay matches seven known forwards from their own mailbox.

### Intake authority

Captured from an owner-approved rollout plan that names this change first. Capture grants no priority, Ready transition, implementation, acceptance or publication authority.
