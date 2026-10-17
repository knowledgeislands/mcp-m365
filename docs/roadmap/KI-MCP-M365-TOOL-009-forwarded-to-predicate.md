---
id: KI-MCP-M365-TOOL-009
area: TOOL
title: Forwarded-to predicate
kind: deliver
horizon: now
status: awaiting-review
blocks: []
blocked_by: []
baseline_ref: d46bc502465be1f276795c5bedde4a51825d4d07
created_at: 2026-10-17T13:59:45Z
updated_at: 2026-10-17T14:32:32Z
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

## Current state

At baseline `e401aa3` the engine has no way to relate one message to another. A held folder can only be aged out by an `age:` rule, which archives unresolved items blind; the deploying owner has removed that rule and archives forwarded items by hand. The thread-follow work in KI-MCP-M365-TOOL-008 adds the run layer's lazy lookup step, which this record reuses.

## Steps

- [x] Parser: accept the negatable predicate `forwarded-to:<address>`, which must be a full address (no wildcard).
- [x] Matcher: `forwarded-to:<address>` holds only when the run layer resolved exactly one forward for that address. Pure, no I/O.
- [x] Pure matching in `src/main/triage/lookups.ts`: normalise subjects (strip repeated `RE:`, `FW:` and `Fwd:` prefixes, case and whitespace); accept a candidate only when it is from the mailbox owner, addressed (to or cc) to the address, its subject starts with `FW:` or `Fwd:` and normalises to the original's, it was received after the original and within 90 days, and, when both carry attachments, they share a file name. Candidates with the same `internetMessageId` count once, so the Sent Items copy and the copy that comes back through the shared address are one forward.
- [x] Graph: `mailboxOwner()` reads the signed-in user's addresses once per call; `searchForwards()` runs a `$search` on sender, recipient and subject words, and the pure filter above decides; `attachmentNames()` lists names only when both messages have attachments. All cached for the call.
- [x] Run layer: extend the lazy lookup so a message reaching the first rule that tests `forwarded-to:` has each address in the block resolved, then classify again.
- [x] Report: a matched item carries `forward` (address, subject and received time of the forward); the result gains `forwardMatched` (count) and `forwardAmbiguous` (each message with two or more candidates, its address and the candidate count), and the text summary lists the ambiguous ones for the owner.
- [x] Lint: `malformed-address` covers `forwarded-to:` values; a wildcard value is a parse error.
- [x] Tests first: parser, matcher, lookups, graph-ops and run, covering the six Verification cases, the de-duplicated Sent Items copy, and the backward-compatibility case.
- [x] Documentation: the routing guide (including that only one side of a pair needs `save-attachments:`), the aged and triage tool descriptions, AGENTS.md's routing-engine section, and CHANGELOG.

## Files touched

- `src/main/triage/types.ts`, `parser.ts`, `matcher.ts`, `lint.ts`, `lookups.ts`, `graph-ops.ts`, `run.ts`, `index.ts`
- The matching `*.test.ts` files
- `src/tools/triage/index.ts` (descriptions only)
- `docs/guides/user/email-routing.md`, `AGENTS.md`, `CHANGELOG.md`

## Verify

- `bunx tsc --noEmit`, `bunx @biomejs/biome check .`, `bunx rumdl check .`, `bun run test`, `bun run test:coverage` at 100% on all four metrics, `bun run build`, `bun run ki:test:smoke`.
- Fixture tests show: one forward matches and the rule's actions run; two distinct forwards leave the predicate false and list the message as ambiguous; a forward after 90 days, one with no shared attachment name, and one to a different address do not match; a subject differing only by prefix and case matches; a Sent Items copy and its returned copy count as one forward.
- An unchanged rule file with no `forwarded-to:` predicate makes no new Graph call and produces the same result as before.

## Dependencies / blocks

Builds on the lazy lookup step from KI-MCP-M365-TOOL-008; both land in one sequence, thread-follow first. KI-MCP-M365-TOOL-015 owns content-level attachment de-duplication; this record documents the one-side harvesting convention instead.

## Documentation impact

### Decision Records

None. The predicate extends the rule language within the existing engine boundaries.

### Specifications

None. The guide and tool descriptions are the rule language's contract.

### Guides

`docs/guides/user/email-routing.md` gains the predicate, its four match conditions, the three outcomes, and the one-side harvesting convention.

### Roadmap

None beyond this record. Listing an unmatched item after a period remains the caller's reporting concern, as the Boundary states.

## Review

### Delivered

The `forwarded-to:<address>` predicate as planned: parser and lint validation of a full address, a pure matcher that holds only for exactly one resolved forward, the pure candidate filter and subject normalisation in `src/main/triage/lookups.ts`, three cached Graph reads, the run layer's lazy resolution, and the `forward`, `forwardMatched` and `forwardAmbiguous` report fields. Excluded as planned: any change to the forward copy, a timer-based fallback, and Outlook's `PidTagLastVerbExecuted` marker. Baseline `d46bc50`; the evidence is the uncommitted working tree reviewed here and this committed record.

### Change Summary

- `types.ts`: `forwarded-to` joins the predicate keys but not the broad keys; `EmailRecord` gains `forwards`, keyed by lower-cased address, and `ForwardMatch` holds a forward's subject and received time.
- `parser.ts`, `lint.ts`: a value with a wildcard, space or quote is a parse error; `malformed-address` now also checks `forwarded-to:` values and asks for a full address. `forwarded-to` stays out of the address keys that drive subsumption, so collision and shadowing analysis is unchanged.
- `matcher.ts`: the predicate holds when the record carries exactly one forward for the address. Pure, as before.
- `lookups.ts`: `normaliseSubject()` strips repeated `RE:`, `FW:` and `Fwd:` prefixes, case and spacing; `forwardCandidates()` applies the owner, recipient, subject and 90-day conditions and counts copies with one `internetMessageId` (or, lacking one, one identity) once; `sharesAttachmentName()`, `forwardAddressesToResolve()` and `forwardFor()` support the run layer.
- `graph-ops.ts`: `mailboxOwner()` reads `me` for `mail` and `userPrincipalName`; `searchForwards()` runs a KQL `$search` on `recipients:` and the normalised subject, top 50, quoting as `src/main/email/search.ts` does; `attachmentNames()` lists names only.
- `run.ts`: after the thread step, the loop resolves only the addresses in groups whose other terms already hold, at or above the current match, then classifies again until stable, so a forward that unseats a match still reaches a thread rule below. The owner is read once per call, searches are cached by address and normalised subject, and names by message id. A failed lookup becomes a warning and reads as no forward. The new result fields appear only when the block tests `forwarded-to:`.
- Documentation: a new section of the routing guide covering the four conditions, the three outcomes and the one-side `save-attachments:` convention; the aged, triage and lint tool descriptions; AGENTS.md's lazy-lookup invariant; CHANGELOG.

### Verification

- `bunx tsc --noEmit`: passed.
- `bunx @biomejs/biome check .`: passed, apart from the pre-existing warning in `src/main/calendar/availability.test.ts`.
- `bunx rumdl check .`: passed.
- `bun run test`: 1307 tests passed in 44 files.
- `bun run test:coverage`: 100% statements, branches, functions and lines.
- `bun run build`: passed.
- `bun run ki:test:smoke`: passed, 45 tools.
- Fixture tests cover the six planned cases (one match, two candidates, outside the window, no shared attachment name, a different address, a subject differing only by prefix and case), the de-duplicated Sent Items copy, and the backward-compatibility case: a rule file without `forwarded-to:` reads neither `me` nor runs a search, and its result has no new fields.

### Outstanding concerns

- Graph's acceptance of the `$search` shape (`recipients:` with a quoted subject phrase) and of `me` with `$select` is proved by fixtures only; no live call was authorised. The owner's report-mode replay against the seven known forwards is the first live proof. A rejected query surfaces as a per-message warning, not a failed run.
- The plan named sender, recipient and subject words for the search. The sender is not in the query: the owner's addresses are checked by the pure filter instead, which keeps the query to one form whatever addresses the account carries. `recipients:` covers To and Cc.
- `$search` returns at most 50 candidates. A subject forwarded to the same address more than 50 times could miss the real forward; it then reads as no match, which leaves the item held rather than archiving it wrongly.
- Deployment needs a rebuild and a restart of the live mcporter daemon by the owner; neither was done here.

No follow-on work needs its own identifier.

### Post-change review

The goal is met within the boundary: a held item is archived once exactly one forward of it exists, and an ambiguous case moves nothing and is named for the owner. Regression risk is low: every new call is reachable only from a rule that tests `forwarded-to:`, and the parser accepts every file it accepted before. The record is ready for acceptance once the owner has reviewed the diff; live acceptance is the report-mode replay of the seven known forwards.

### Mini recap

Delivered the forwarded-to predicate tests first, with documentation and full gates green. The open concern is live confirmation of the search query shape. Learning route: the lazy-lookup loop in `run.ts` now serves two cross-message predicates, and AGENTS.md records how a third should join it.

## Discussion

### Planning decisions

- **Graph query shape.** `$search` supports `from:`, `to:` and `subject:` on messages but cannot be combined with `$filter` or `$orderby`, and it matches words rather than exact phrases. It is therefore used only to fetch candidates; the received window, the subject equality and the recipient test are applied by the pure filter. Up to 50 candidates are read. No live call was made during planning.
- **Duplicate copies.** A forward to a shared address the owner also receives exists twice in the mailbox: in Sent Items and as the returned copy. Both share an `internetMessageId`, so candidates are counted by it. Without this every real forward would read as ambiguous.
- **Outlook's forwarded marker.** `PidTagLastVerbExecuted` is readable through Graph as the extended property `Integer 0x1081`. It is not used: it can never establish or block a match, so reading it would add a call per message without changing an outcome. Enabling it in the shared select would also start populating `status:replied`, which today is never set, and so would change how existing rule files behave.
- **Mailbox owner.** The owner's addresses come from the signed-in user (`mail` and `userPrincipalName`), not from configuration, so the predicate stays generic.
- **Approval.** Planned to Ready under the deploying owner's rollout approval and the coordinator's Decision 6.

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

Captured from an owner-approved rollout plan that names this change first. Capture grants no priority, Ready transition, implementation, acceptance or publication authority. Adopted on 17 October 2026 under the deploying owner's approved rollout, which sets the horizons and names this record's place in the sequence; adoption grants no Ready transition, acceptance or publication authority.
