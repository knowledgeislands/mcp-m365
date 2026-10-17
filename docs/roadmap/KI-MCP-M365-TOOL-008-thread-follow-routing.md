---
id: KI-MCP-M365-TOOL-008
area: TOOL
title: Thread-follow routing
kind: deliver
horizon: next
status: ready
blocks: []
blocked_by: []
baseline_ref: null
created_at: 2026-10-17T13:59:45Z
updated_at: 2026-10-17T14:02:35Z
---

## Goal

A reply to a conversation that has already been filed is routed to the same folder as the rest of its conversation, without a rule having to recognise the reply's sender or subject.

## Context

The routing engine in `src/main/triage/` classifies each message on its own fields. A reply from a new participant, or one whose subject has drifted, therefore falls through to the fallback folder even when every earlier message in its conversation was filed. In one deployment's sample, about 60 of the 92 messages in the fallback folder on a single day were replies to conversations already filed elsewhere. This is the largest single reduction in unclassified mail available, and the owner of that deployment has asked for it first, alongside KI-MCP-M365-TOOL-009.

Graph exposes `conversationId` on every message, but `TRIAGE_SELECT_FIELDS` in `src/main/triage/message.ts` does not request it, so the engine cannot see conversation membership today.

The proposed rule-language surface is one predicate and one move target:

```rules
thread:filed -> move:@thread
```

- `thread:filed` is true when another message in the same conversation already sits in a routing destination folder, or in an archive folder.
- `move:@thread` resolves to the folder of the most recent such sibling. When the sibling is in an archive folder, it resolves to the destination folder that archive is fed from, so a live reply returns to the working folder rather than the archive.
- When a judgment category is in use (KI-MCP-M365-TOOL-010), the move carries the sibling's category with it.

## Boundary

Conversation lookup and the two rule-language elements only. Do not add a model call, change how existing predicates match, or move mail that a higher rule has already claimed: ordering stays first-match-wins, and the rule note decides where `thread:filed` sits. Do not route on the Graph message id, which is reissued on every move; conversation identity comes from `conversationId`, and message identity stays subject, sender and received time.

## Current state

At baseline `e401aa3` the engine classifies each message on its own fields only. `TRIAGE_SELECT_FIELDS` does not request `conversationId`, `EmailRecord` has no conversation field, the grammar has no `thread:` predicate, and `move:` accepts only a literal folder name. A reply whose sender and subject no rule recognises falls to the inbound fallback. Nothing in the engine reads another message's folder.

## Steps

- [ ] Add `conversationId` to `TRIAGE_SELECT_FIELDS` and carry it on `EmailRecord`, with a `thread` field the run layer fills before matching.
- [ ] Parser: accept the predicate `thread:filed` (the only value) and the move target `move:@thread` (unquoted only; a quoted `"@thread"` stays a literal folder name).
- [ ] Matcher: `thread:filed` holds when the record's resolved thread names a folder. Pure, no I/O.
- [ ] Pure thread resolution in a new `src/main/triage/lookups.ts`: derive the filed folders from the rule file (every `move:` target in the inbound block except the fallback's, and every archive an aged-block rule feeds, mapped back to the `_TRIAGE` folder or folders that feed it) and choose the target from a list of siblings, most recent first, excluding the message itself by identity.
- [ ] Graph: `listConversation()` in `graph-ops.ts`, one query per conversation, cached for the call.
- [ ] Run layer: resolve threads lazily. Classify first without lookups; only when the winning rule sits at or below the first rule that tests `thread:` look the conversation up and classify again. Substitute the resolved folder for `@thread` before actions run, so tracking, the report and `applyActions` see a concrete path.
- [ ] Report: each item routed through `@thread` carries `thread.folder` and `thread.alternatives` (other filed folders in the conversation), and the text summary names them.
- [ ] Lint: `thread-target-without-thread` (blocking) when a rule uses `move:@thread` in a group that does not test `thread:filed`; `thread` counts as a broad key for `broad-rule-collision`; `unknown-folder` skips `@thread`.
- [ ] Tests first for each unit: parser, matcher, lint, lookups, graph-ops and run, covering the five Verification cases and the backward-compatibility case.
- [ ] Documentation: the routing guide's rule-file section, the `m365_email_routing_triage` and `m365_email_routing_aged` tool descriptions, the lint tool description, AGENTS.md's routing-engine section, and CHANGELOG.

## Files touched

- `src/main/triage/types.ts`, `message.ts`, `parser.ts`, `matcher.ts`, `lint.ts`, `graph-ops.ts`, `run.ts`, `index.ts`
- `src/main/triage/lookups.ts` (new, pure) and `lookups.test.ts`
- The matching `*.test.ts` files
- `src/tools/triage/index.ts` (descriptions only)
- `docs/guides/user/email-routing.md`, `AGENTS.md`, `CHANGELOG.md`

## Verify

- `bunx tsc --noEmit`, `bunx @biomejs/biome check .`, `bunx rumdl check .`, `bun run test`, `bun run test:coverage` at 100% on all four metrics, `bun run build`, `bun run ki:test:smoke`.
- Fixture tests show: a single filed sibling routes the reply to its folder; a sibling in an archive routes to the feeding `_TRIAGE` folder; siblings in two folders choose the most recent and report the other; no siblings leaves `thread:filed` false and the message falls through; a sibling whose Graph id changed is still found, because lookup is by `conversationId` and self-exclusion is by subject, sender and received time.
- An unchanged rule file with no `thread:` predicate makes no conversation query and produces the same result as before.

## Dependencies / blocks

None in build order. KI-MCP-M365-TOOL-010 will later carry a sibling's judgment category with the move; that is out of scope here. KI-MCP-M365-TOOL-009 shares the lazy-lookup step in the run layer and lands after this record.

## Documentation impact

### Decision Records

None. The rule language is already governed by the routing design note and the guide; this extends it without changing an architectural boundary.

### Specifications

None. The repository holds no behaviour specification for the rule language; the guide and tool descriptions are its contract.

### Guides

`docs/guides/user/email-routing.md` gains thread-follow: the predicate, the target, where to place the line, how archives resolve, and how ambiguity is reported.

### Roadmap

None beyond this record. KI-MCP-M365-TOOL-010's category carry-over is already recorded there.

## Discussion

### Planning decisions

- **Ambiguity.** The most recent filed sibling wins, by received time; the other filed folders are reported as `alternatives` on the item so the owner can see the conversation is split. Leaving such mail unrouted would put it back in the fallback, which is the problem this record exists to solve.
- **Archives.** An archive's feeding folder is read from the aged block: a rule testing `folder:X` that moves to an archive means the archive is fed from `_TRIAGE/X`. An archive fed from two or more folders cannot be resolved this way, so a sibling there is skipped and the next most recent sibling decides. The decision is reported, not guessed.
- **Cost.** The lookup runs only for messages that reach the first `thread:` rule, so carve-outs and party rules above it cost nothing extra, and a file without `thread:` makes no new call at all.
- **Graph query.** `me/messages` filtered by `conversationId`, with `receivedDateTime` placed first in the filter so it may also be the sort key, newest first, capped at 25. No live call was made during planning; the query shape is unit-tested against fixtures only.
- **Approval.** Planned to Ready under the deploying owner's rollout approval and the coordinator's Decision 6, which authorises planning and implementing this record through Awaiting review.

### Where the lookup lives

`parser.ts`, `matcher.ts`, `lint.ts` and `folders.ts` are pure and must stay so, because the replay suite asserts real findings against exactly the code that runs live. The sibling lookup is Graph I/O, so it belongs in `graph-ops.ts` or the run layer, which resolves `thread:filed` and `@thread` into plain data before the pure matcher sees the record. Cache lookups per conversation for the duration of one call so a busy thread costs one query, not one per message.

### Lint

Lint should flag `move:@thread` on a rule that does not also test `thread:filed`, since the target is undefined without a sibling, and should treat `thread:filed` as content-agnostic for `broad-rule-collision`, so a thread-follow line placed above specific rules is reported for review.

### Ambiguity

A conversation whose siblings sit in two different destination folders needs a deterministic answer. The proposal is the most recent sibling; an alternative is to report it and leave the message unrouted. Decide during planning, and report either outcome in the run result.

### Verification

Unit tests over fixture conversations: single sibling, archived sibling, siblings in two folders, no siblings, and a reply whose Graph id changed after a move. The deploying owner's acceptance test is a report-mode replay of one day's fallback-folder contents that places most replies by thread-follow.

### Intake authority

Captured from an owner-approved rollout plan that names this change first. Capture grants no priority, Ready transition, implementation, acceptance or publication authority. Adopted on 17 October 2026 under the deploying owner's approved rollout, which sets the horizons and names this record's place in the sequence; adoption grants no Ready transition, acceptance or publication authority.
