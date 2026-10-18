---
id: KI-MCP-M365-TOOL-010
area: TOOL
title: Category-aware rules
kind: deliver
status: done
blocks: [KI-MCP-M365-TOOL-012]
blocked_by: []
baseline_ref: fbd2faacbbfd690a35cb2d99e1b46af4db70b929
created_at: 2026-10-17T13:59:45Z
updated_at: 2026-10-18T00:35:39Z
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

## Current state

At baseline `fbd2faa` the engine writes a category with `tag:<name>` but cannot read one back: `categories` is not in `TRIAGE_SELECT_FIELDS`, `EmailRecord` has no category field, there is no `category:` predicate, and there is no way to remove a category or to match a message without acting on it. `tag:` de-duplicates by exact spelling, so `tag:beacon` on a message already carrying `BEACON` adds a second entry Outlook treats as the same category. The note may declare ` ```rules ` and ` ```destinations ` blocks only. The live HNR rule note already uses `tag:` in its aged block, with no category declaration.

## Steps

- [x] Types: add `category` to `PREDICATE_KEYS`; add `untag` and `hold` to `ActionKind`; add `categories?: string[]` to `EmailRecord`; add a `CategoryDecl` and `ParseResult.categories`.
- [x] Parser: accept the negatable `category:<name>` predicate, the `untag:<name>` action and the bare `hold` action, which must be its rule's only action. Parse a ` ```categories v1 ` block of one name per line, `#` comments and blanks ignored, refusing an empty name, a duplicate (case-insensitive), and a name containing `,` or `"`. A line containing `=` is refused as reserved, so a later provider setting such as a Gmail tag prefix can use `key = value` without ambiguity.
- [x] Matcher: `category:<name>` holds when the record carries that category, compared case-insensitively. Pure, no I/O.
- [x] Normalisation: request `categories` in `TRIAGE_SELECT_FIELDS` and carry it onto `EmailRecord` in `toEmailRecord`.
- [x] Graph: `untag:` reads the message's categories and writes them back without the named entry, compared case-insensitively; an absent category is a successful no-op with no write. `tag:` de-duplicates case-insensitively.
- [x] Run layer: a message whose winning rule is `hold` is applied nothing, never counts towards `maxActions`, `acted` or `remaining`, and is not written to tracking. The result gains `held` (the held messages, with rule line and ruleset) whenever the block has a `hold` rule, and the text summary reports the count.
- [x] Lint: when the note declares a ` ```categories ` block, every `tag:`, `untag:` and `category:` name it does not declare is an `unknown-category` error, which blocks a run as `unknown-destination` does; a name declared only in another case is a `category-case` warning. When the note declares no block, a rule using `category:` or `untag:` draws one `undeclared-categories` warning, and `tag:` alone stays silent so existing notes lint as before.
- [x] Tests first: parser, matcher, message, lint, graph-ops and run, covering each Verify case.
- [x] Documentation: the routing guide, the triage and aged tool descriptions, AGENTS.md's routing-engine section, and CHANGELOG.

## Files touched

- `src/main/triage/types.ts`, `parser.ts`, `matcher.ts`, `message.ts`, `lint.ts`, `graph-ops.ts`, `run.ts`, `index.ts`
- The matching `*.test.ts` files
- `src/tools/triage/index.ts` (descriptions only)
- `docs/guides/user/email-routing.md`, `AGENTS.md`, `CHANGELOG.md`

## Verify

- `bunx tsc --noEmit`, `bunx @biomejs/biome check .`, `bunx rumdl check .`, `bun run test`, `bun run test:coverage` at 100% on all four metrics, `bun run build`, `bun run ki:test:smoke`, and `ki repo audit`.
- Fixture tests show: `category:` and `!category:` match by name in any case; `untag:` removes the named entry and keeps the others, and an absent category makes no write; `tag:` does not add a case variant of a category already present; a `hold` rule reports the message as held with no Graph call, and a held message neither consumes `maxActions` nor sets `remaining`; the shield and lapse lines from Context route as intended in the aged pass; an undeclared name blocks a run when a categories block exists; `hold` beside another action, a duplicate declaration and a `name = value` line are parse errors.
- The live HNR rule note's current text, which uses `tag:` and declares no categories, lints with the same findings as before.

## Dependencies / blocks

None in build order. KI-MCP-M365-TOOL-008, which also extended the select list, is delivered. KI-MCP-M365-TOOL-012 builds on this record. Creating the `Routed: judged` and `Routed: unsure` master categories is the deploying owner's manual step, as the Boundary states.

## Documentation impact

### Decision Records

None. The additions extend the rule language within the existing engine boundaries.

### Specifications

None in this repository. The normative grammar still lives in hnr-shared's Email Routing Engine Design note until the SPEC-HOME decision moves it; that note needs the same three additions, which this record does not make.

### Guides

`docs/guides/user/email-routing.md` gains `category:`, `untag:`, `hold`, the categories block and the three lint codes.

### Roadmap

None beyond this record.

## Review

### Delivered

Category-aware rules, built tests first: the `category:` predicate, the `untag:` and `hold` actions, and an optional ` ```categories v1 ` block that declares the names rules may use. A `tag:` no longer adds a case variant. Documentation and every gate are green. Nothing was deployed, and the live mailbox and the mcporter daemon were not touched.

### Change Summary

- `types.ts`: `category` joins the predicate keys but not the broad keys. `ActionKind` gains `untag` and `hold`, `EmailRecord` gains `categories`, and `CategoryDecl` and the optional `ParseResult.categories` are new. `index.ts` re-exports `CategoryDecl`.
- `parser.ts`: parses `category:` (negatable), `untag:` and the bare `hold`, and refuses `hold` beside any other action. A name containing `,` or `"` is refused wherever it is read. The ` ```categories v1 ` block takes one name per line, with blanks, `#` lines and trailing comments ignored, and refuses a case-insensitive duplicate and any `=` line as reserved. Several blocks merge in order. `categories` is absent when the note declares no block, which keeps checks opt-in.
- `matcher.ts`: `category:` compares case-insensitively over the fetched list. Pure, as before.
- `message.ts`: `categories` joins `TRIAGE_SELECT_FIELDS`, and `toEmailRecord` carries an array value.
- `graph-ops.ts`: `tag:` and `untag:` share one read-then-write path, comparing case-insensitively. When nothing would change, both return ok with `already present` or `not present` and make no write. `hold` is not executable, so `applyActions` never acts on it.
- `lint.ts`: `unknown-category` (error) and `category-case` (warning) apply when a block exists. Without a block, one `undeclared-categories` warning goes on the first rule that tests or removes a category, and `tag:` alone stays silent.
- `run.ts`: `unknown-category` joins the blocking codes. A message whose winning rule is `hold` is recorded in `held`, before the executable-actions check, so it is never a candidate, never spends `maxActions`, never sets `remaining` and is never tracked. `held` is present only when the block has a `hold` rule, and the summary gives its count.
- Documentation: the routing guide has a new "Route on categories" section with its categories-block subsection, plus the predicate, action and lint lists. The triage and aged tool descriptions, AGENTS.md's routing-engine section and CHANGELOG are updated.

### Verification

- `bunx tsc --noEmit`: pass.
- `bunx @biomejs/biome check .`: no errors. The single warning is pre-existing, in `src/main/calendar/availability.test.ts`.
- `bunx rumdl check .`: no issues.
- `bun run test`: 1351 tests in 45 files pass.
- `bun run test:coverage`: 100% on statements (3643), branches (2429), functions (526) and lines (3264).
- `bun run build`: pass. `bun run ki:test:smoke`: pass, with modern discovery, the legacy fallback, 45 tools and a valid result envelope.
- `ki repo audit`: PASS=18 WARN=2 FAIL=0. Both warnings are pre-existing repository setup and are not touched here: CI pins its KI version inline (CI-1), and there is no committed pre-commit gate (HOOK-1). `ki repo audit --skill ki-work-roadmap`: no issues.
- Each Verify case has a fixture test:
  - `category:` and `!category:` match in any case.
  - `untag:` keeps the other categories, and an absent category or a missing list makes no write.
  - `tag:` in any case makes no write when the category is already present.
  - A held message makes no Graph call, spends nothing from `maxActions`, leaves `remaining` false and is not tracked.
  - The shield, lapse and disposal lines route as intended, in both the matcher and an aged pass.
  - An undeclared name refuses the run before any Graph call.
  - `hold` beside another action, a duplicate declaration and a `name = value` line are parse errors.
- The live HNR rule note was read only and linted with the baseline code and with this change, on 380 inbound and 19 aged rules. Both runs gave zero findings.

### Outstanding concerns

- **Held mail still fills the listing window.** Each folder is listed oldest first, in a window one larger than `maxActions`. Held messages do not spend `maxActions`, but they do take places in that window. When more held mail than `maxActions` sits at the old end of a folder, the aged pass reports `remaining` with nothing acted on, which ends the documented loop. It stops rather than spinning, and raising `maxActions` clears it. A test pins this behaviour and the guide states it. Decoupling the window from `maxActions` would change the batch contract, so it is outside this record.
- **A small `tag:` behaviour change.** Re-tagging a category that is already present used to rewrite the same list. It now makes no write and reports `already present`. The mailbox ends in the same state.
- **Owner steps before the shield can run.** Kris creates the `Routed: judged` and `Routed: unsure` master categories by hand. Adding a categories block and shield lines to the HNR note is a separate edit, and is not made here.
- **Specification.** hnr-shared's Email Routing Engine Design note needs the same three additions. They wait on the SPEC-HOME decision.
- **Stale guidance, not fixed here.** AGENTS.md cites `replay.test.ts` and `fixtures/routing/email-routing-rules.md`, and neither exists. Only `fixtures/routing/example-rules.md` does.

### Post-change review

The diff stays inside Files touched. The pure modules have no I/O, and Graph writes stay in `graph-ops.ts`. Category names stay provider-free, and the reserved `key = value` line leaves room for a Gmail label prefix without a grammar change. The design boundary therefore holds, no conflict with the Gmail design was found, and no shared-engine extraction was started. A rule file without the new terms parses, lints and routes exactly as before, and the live note confirms it.

### Mini recap

Category-aware rules are delivered tests first, with full gates green and no deployment. The one design finding is that `hold` keeps held mail out of the batch budget but not out of the listing window. Learning route: the windowing in `runPass` now carries non-work as well as work, so any later claim-without-action term should join `held` rather than the candidates.

## Done

Accepted by Kris Brown on 18 October 2026, in Kris's words: "ACCEPT-010 \"After the report check\" - accept KI-MCP-M365-TOOL-010 once that check shows no change." The acceptance rests on the six-part Review above and on the deploy010 report check. The build of `1b597b4`, whose code is that of `8057d19`, was deployed to the mcporter daemon on 18 October 2026, and the daemon was restarted at 01:34 BST. The old daemon was confirmed retired and the new one up. A lint of a test note with a categories block returned `unknown-category` for an undeclared name, which only this build can give. Against the live HNR note, the aged and inbound passes in report mode gave the same result before and after the deploy: aged considered 177 and acted on none, inbound considered none. Lint gave zero findings on 380 inbound and 19 aged rules both times. Because no mail was due for action, the check proves the live note parses and selects identically, not that each action routes identically. Every Step is complete. The new terms get their first live use through KI-MCP-M365-TOOL-012, and the held-mail listing window stays an accepted limit, as Outstanding concerns states.

## Discussion

### Purity

`category:` is a pure test over a field already fetched, so it belongs in `matcher.ts` with no I/O. `untag:` is applied in `graph-ops.ts` alongside `tag:`, by writing the message's category list without the named entry. `hold` is handled in the run layer so it stops evaluation for that message without counting as a mutation against `maxActions`.

### Case and spelling

Outlook category names are case-insensitive in the client but stored as written. Planning chose case-insensitive comparison; see Decisions taken in planning.

### Verification

Parser, matcher and lint unit tests for each new element, including negation, an undeclared name, an `untag:` of an absent category (a no-op, not a failure), and `hold` reported in the result without a Graph call.

### Intake authority

Captured from an owner-approved rollout plan (phase 2, after KI-MCP-M365-TOOL-008 and KI-MCP-M365-TOOL-009). Capture grants no priority, Ready transition, implementation, acceptance or publication authority. Adopted on 17 October 2026 under the deploying owner's approved rollout, which sets the horizons and names this record's place in the sequence; adoption grants no Ready transition, acceptance or publication authority. Promoted to Next and planned to Ready on 17 October 2026 under the owner's PHASE-2 decision, which authorises an agent to plan and build it; that grants no acceptance, deployment or publication authority.

### Decisions taken in planning

- **Case.** `category:`, `untag:` and `tag:` de-duplication compare case-insensitively. Outlook and Gmail both treat category or label names that differ only by case as one name, so the choice is mailbox-neutral, and the `category-case` warning keeps the spelling written by `tag:` consistent with the declaration.
- **`hold` and `remaining`.** A held message is not work. Counting it would make `remaining` true for as long as held mail sits in a folder, so the documented loop would never end; it is reported in `held` instead.
- **Opt-in category checks.** The live note tags project archives with no categories block. Making every undeclared `tag:` an error would block today's runs, so checks start when the note declares its block, and only the new `category:` and `untag:` draw a warning without one.
- **Not a broad predicate.** `category:` is not added to the broad keys. A category is set deliberately on chosen mail, and the shield line is meant to pre-empt the retention lines below it.

### Mailbox-neutral boundary

The rule syntax follows the [Gmail routing design](/Users/krisbrown/workspaces/humans-not-robots/hnr-principal/+/_THREADS/email-routing/2026-10-17-gmail-routing-design.md): `category:`, `untag:`, `hold` and the categories block are provider-free, the predicate and lint are pure, and only the category write sits in the Graph layer. On Gmail a category becomes a label under a tag prefix the categories block will declare; the reserved `key = value` line form leaves room for that without a grammar change. No shared-engine extraction is started here.
