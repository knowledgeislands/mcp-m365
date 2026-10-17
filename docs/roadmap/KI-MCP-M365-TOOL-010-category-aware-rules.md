---
id: KI-MCP-M365-TOOL-010
area: TOOL
title: Category-aware rules
kind: deliver
horizon: now
status: in-progress
blocks: [KI-MCP-M365-TOOL-012]
blocked_by: []
baseline_ref: fbd2faacbbfd690a35cb2d99e1b46af4db70b929
created_at: 2026-10-17T13:59:45Z
updated_at: 2026-10-17T21:52:51Z
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

- [ ] Types: add `category` to `PREDICATE_KEYS`; add `untag` and `hold` to `ActionKind`; add `categories?: string[]` to `EmailRecord`; add a `CategoryDecl` and `ParseResult.categories`.
- [ ] Parser: accept the negatable `category:<name>` predicate, the `untag:<name>` action and the bare `hold` action, which must be its rule's only action. Parse a ` ```categories v1 ` block of one name per line, `#` comments and blanks ignored, refusing an empty name, a duplicate (case-insensitive), and a name containing `,` or `"`. A line containing `=` is refused as reserved, so a later provider setting such as a Gmail tag prefix can use `key = value` without ambiguity.
- [ ] Matcher: `category:<name>` holds when the record carries that category, compared case-insensitively. Pure, no I/O.
- [ ] Normalisation: request `categories` in `TRIAGE_SELECT_FIELDS` and carry it onto `EmailRecord` in `toEmailRecord`.
- [ ] Graph: `untag:` reads the message's categories and writes them back without the named entry, compared case-insensitively; an absent category is a successful no-op with no write. `tag:` de-duplicates case-insensitively.
- [ ] Run layer: a message whose winning rule is `hold` is applied nothing, never counts towards `maxActions`, `acted` or `remaining`, and is not written to tracking. The result gains `held` (the held messages, with rule line and ruleset) whenever the block has a `hold` rule, and the text summary reports the count.
- [ ] Lint: when the note declares a ` ```categories ` block, every `tag:`, `untag:` and `category:` name it does not declare is an `unknown-category` error, which blocks a run as `unknown-destination` does; a name declared only in another case is a `category-case` warning. When the note declares no block, a rule using `category:` or `untag:` draws one `undeclared-categories` warning, and `tag:` alone stays silent so existing notes lint as before.
- [ ] Tests first: parser, matcher, message, lint, graph-ops and run, covering each Verify case.
- [ ] Documentation: the routing guide, the triage and aged tool descriptions, AGENTS.md's routing-engine section, and CHANGELOG.

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
