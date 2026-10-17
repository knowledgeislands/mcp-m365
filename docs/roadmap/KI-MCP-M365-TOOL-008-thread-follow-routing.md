---
id: KI-MCP-M365-TOOL-008
area: TOOL
title: Thread-follow routing
status: triage
blocks: []
blocked_by: []
baseline_ref: null
created_at: 2026-10-17T13:59:45Z
updated_at: 2026-10-17T13:59:45Z
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

## Discussion

### Where the lookup lives

`parser.ts`, `matcher.ts`, `lint.ts` and `folders.ts` are pure and must stay so, because the replay suite asserts real findings against exactly the code that runs live. The sibling lookup is Graph I/O, so it belongs in `graph-ops.ts` or the run layer, which resolves `thread:filed` and `@thread` into plain data before the pure matcher sees the record. Cache lookups per conversation for the duration of one call so a busy thread costs one query, not one per message.

### Lint

Lint should flag `move:@thread` on a rule that does not also test `thread:filed`, since the target is undefined without a sibling, and should treat `thread:filed` as content-agnostic for `broad-rule-collision`, so a thread-follow line placed above specific rules is reported for review.

### Ambiguity

A conversation whose siblings sit in two different destination folders needs a deterministic answer. The proposal is the most recent sibling; an alternative is to report it and leave the message unrouted. Decide during planning, and report either outcome in the run result.

### Verification

Unit tests over fixture conversations: single sibling, archived sibling, siblings in two folders, no siblings, and a reply whose Graph id changed after a move. The deploying owner's acceptance test is a report-mode replay of one day's fallback-folder contents that places most replies by thread-follow.

### Intake authority

Captured from an owner-approved rollout plan that names this change first. Capture grants no priority, Ready transition, implementation, acceptance or publication authority.
