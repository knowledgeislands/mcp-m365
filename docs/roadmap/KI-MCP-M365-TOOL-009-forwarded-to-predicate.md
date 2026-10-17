---
id: KI-MCP-M365-TOOL-009
area: TOOL
title: Forwarded-to predicate
kind: deliver
status: done
blocks: []
blocked_by: []
baseline_ref: d46bc502465be1f276795c5bedde4a51825d4d07
created_at: 2026-10-17T13:59:45Z
updated_at: 2026-10-17T17:46:22Z
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
- `graph-ops.ts`: `mailboxOwner()` reads `me` for `mail` and `userPrincipalName`; `searchForwards()` runs a KQL `$search` on `recipients:` and the normalised subject, top 50, built by the shared `src/utils/kql.ts` (see [Search fix](#search-fix)); `attachmentNames()` lists names only.
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

- **Resolved, 17 October 2026:** the first live proof found Graph rejecting the forward search. `1091f66` fixed the quoting, and the second proof passed. See [Live proof](#live-proof) and [Search fix](#search-fix) under Discussion. A rejected query still surfaces as a per-message warning, not a failed run.
- No end-to-end positive match has run through the aged pass. Every original with a known forward had already been archived by hand, outside the `_TRIAGE` folders the pass reads, and moving mail back was outside the proof's authority. The positive cases were proved with the predicate's own lookup functions run read-only against the archived originals, so the first live match through the pass will be the first new forward of a held item.
- The plan named sender, recipient and subject words for the search. The sender is not in the query: the owner's addresses are checked by the pure filter instead, which keeps the query to one form whatever addresses the account carries. `recipients:` covers To and Cc.
- `$search` returns at most 50 candidates. A subject forwarded to the same address more than 50 times could miss the real forward; it then reads as no match, which leaves the item held rather than archiving it wrongly.
- Deployed to the live mcporter daemon on 17 October 2026 at the build of `889dc61`, with the build of `ff58e39` kept as a rollback point.

No follow-on work needs its own identifier.

### Post-change review

The goal is met within the boundary: a held item is archived once exactly one forward of it exists, and an ambiguous case moves nothing and is named for the owner. Regression risk is low: every new call is reachable only from a rule that tests `forwarded-to:`, and the parser accepts every file it accepted before. The report-mode replay and the read-only check of the known forwards both passed, so the record is ready for acceptance by the owner.

### Mini recap

Delivered the forwarded-to predicate tests first, with documentation and full gates green. The search quoting failed its first live proof and was fixed in a shared query builder that also serves the general mail search; the second proof passed. Learning route: the lazy-lookup loop in `run.ts` now serves two cross-message predicates, and AGENTS.md records how a third should join it.

## Done

Accepted by Kris Brown on 17 October 2026, in his words: "ACCEPT-FORWARD a) Accept KI-MCP-M365-TOOL-009 now, on this live proof." The acceptance rests on the six-part Review above, the [Search fix](#search-fix) in `1091f66` and `889dc61`, and the [Second live proof](#second-live-proof) recorded in `41198bb`: the corrected search ran without error on the held folder, and the predicate's own lookups, run read-only against archived originals, found the known forwards. Every Step is complete. No end-to-end positive match has yet run through the aged pass; the first new forward of a held item will be that proof, as Outstanding concerns states, and it stands as an accepted limit rather than a record of its own.

## Discussion

### Live proof

First report-mode replay against the live mailbox on 17 October 2026 at 17:49 BST, on the build of `ff58e39` deployed to the live mcporter daemon at 17:46 BST. The live rule note was passed inline through the tool's `rules` argument, with its aged block replaced by one proof line, `folder:"<held folder>" forwarded-to:<finance mailbox> !status:flagged -> move:<archive>, mark:read`. The note on disk, the tracking cache and the mailbox were left unchanged, and no `rulesPath` or `trackingPath` was passed.

- **The forward search fails live.** The held folder holds two messages. Graph rejected both searches with `400 BadRequest`: "Syntax error: character '@' is not valid at position 20". Each became a warning, both read as no forward, nothing would move, and `forwardAmbiguous` was empty, so the fail-safe held.
- **Cause.** `searchForwards()` in `src/main/triage/graph-ops.ts` wraps the whole KQL string in double quotes and also quotes each property value, so Graph receives `"recipients:"<address>" subject:"<words>""`. The inner quotes end the outer string, and the bare `@` that follows is a syntax error. The fixtures asserted the string the code builds, not one Graph accepts.
- **The same fault is in `m365_email_messages_search`.** `buildSearchParams()` in `src/main/email/search.ts` builds `$search` the same way. A `to:` search fails with the same `400` in both its combined and single-term attempts, then falls back to boolean filters alone, so the results it returns ignore the address without saying so.
- **The known forwards were not counted.** The server offers no other read-only route that reaches them: a plain-text query on Sent Items returned no hits and fell back to recent mail.

This confirms the first Graph concern under Outstanding concerns. The predicate is not ready for acceptance: the `$search` quoting needs rework, with a test that pins a Graph-valid string, and this replay needs to run again.

### Search fix

Fixed in `1091f66`, with `889dc61` as a follow-up, on 17 October 2026.

- **Accepted form.** Graph reads `$search` as one double-quoted string, so every `"` or `\` inside it must be backslash-escaped. Probes against live Graph established the working form, `"recipients:\"finance@example.com\" AND subject:\"invoice 42\""`: each property value phrase-quoted and escaped, clauses joined by an uppercase `AND`. Leaving the inner quotes unescaped fails at the first `@`. Directory-style `"a" AND "b"` clauses are accepted but mis-parse on messages, so they are not used.
- **Shared builder.** `src/utils/kql.ts` builds both searches. A property value loses its quotes, backslashes and control characters, since a KQL phrase has no escape and Graph matches words. Colons, symbols and non-ASCII letters are kept. Tests pin the exact string for addresses and for subjects with quotes, colons and non-ASCII.
- **General search.** `m365_email_messages_search` had the same fault. It also hid the fault by falling back in turn to a single term, to flags alone and finally to recent mail. It now makes one call. A query Graph rejects, or a term left with nothing searchable, is returned as an error. Date bounds join the search instead of being dropped, and every result, empty or not, names the exact Graph search it ran.

### Second live proof

Report-mode replay on 17 October 2026 at 18:11 BST, on the build of `1091f66`, repeated at 18:15 BST on `889dc61` with the same result. The inputs were the same as the first proof: the live rule note passed inline with its aged block replaced by the one proof line, no `rulesPath` or `trackingPath`, and nothing on disk or in the mailbox changed.

- **Held folder.** Both messages were searched without error: no warnings, no matches, no ambiguous matches, nothing moved. Neither message had been forwarded, which the next check confirms, so both results are correct.
- **Known forwards.** The fixed general search, run read-only, found every message the owner sent to the finance mailbox. There were eleven copies of seven distinct messages: five forwards and two replies. Each forward to the shared address appears twice, as the sent copy and the returned copy. All were already in the finance archive, not Sent Items.
- **Positive control.** The predicate's own `mailboxOwner()`, `searchForwards()`, `forwardCandidates()` and `attachmentNames()`, composed as the run layer composes them, were run read-only against fourteen archived originals from three suppliers' recurring receipts and one reply thread. The results:
  - **Two matches.** Both are the forwards whose originals are still in the mailbox. In each, the two copies counted as one forward.
  - **No ambiguous results.**
  - **Twelve correct non-matches.**
    - Ten originals were never forwarded.
    - One forward was found but rejected because no attachment name was shared. It was the next month's receipt, with the same subject, whose original is no longer in the mailbox, so the attachment check prevented a false match.
    - The reply thread was excluded because a reply is not a forward.
- **Misses.** None. Three of the five forwards have no original left in the mailbox, so there was nothing for the predicate to match.
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
