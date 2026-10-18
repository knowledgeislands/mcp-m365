---
id: KI-MCP-M365-TOOL-019
area: TOOL
title: Move the rule specification
kind: deliver
horizon: soon
status: draft
blocks: []
blocked_by: []
baseline_ref: null
created_at: 2026-10-18T00:19:30Z
updated_at: 2026-10-18T00:19:30Z
---

## Goal

The routing rule language has one normative specification beside the engine that implements it, which both mail servers conform to, instead of a grammar held in one deployment's knowledge base.

## Context

The grammar is written today in a deploying knowledge base's `Email Routing Engine Design` note, in its Engineering pillar. A specification shared with a personal mailbox should not depend on that knowledge base. The [Gmail routing design](/Users/krisbrown/workspaces/humans-not-robots/hnr-principal/+/_THREADS/email-routing/2026-10-17-gmail-routing-design.md) proposes moving its normative part, the Rule DSL, Grammar, Predicates, Actions, Semantics, Lint checks and Destinations, and since [KI-MCP-M365-TOOL-010](KI-MCP-M365-TOOL-010-category-aware-rules.md) the categories block, into this repository's `docs/`. This is the design's task 2.

The deploying owner decided on 18 October 2026 (SPEC-HOME) that the specification lives here for now, while the work proceeds, and that its durable home is the Knowledge Islands principal knowledge base, `ki-principal`, because how Knowledge Islands handles email is a Knowledge Islands concern.

## Boundary

Move the normative text and nothing else; the source note keeps its deployment history, migration and division of labour, and links to the moved specification. Changing that note is a separate change in its own repository.

The moved specification opens with a note saying that its durable home is `ki-principal`, and that `mcp-m365` and `mcp-gsuite` conform to it as email-handling implementations. It marks which features are core and which are provider extensions, such as Outlook's flag-complete state.

Where the canonical engine finally lives is still open (the ENGINE-HOME question). This record places the specification in `mcp-m365` under SPEC-HOME and does not presume that answer; if the engine moves, the specification moves with it until `ki-principal` takes it.

## Shaping

- **Approach:** copy the normative sections into one reference under `docs/` with the home note at its top, add the categories block, mark core and provider-extension features, and link the user guide to it.
- **Dependencies:** none in this repository; the source note's change to a pointer is separate work in its own repository.
- **Open decisions:** the exact path; ENGINE-HOME only if the engine leaves this repository.
- **Promotion to Next:** the owner chooses to start phase 0.

## Discussion

### Location

The design suggests the canonical engine's `docs/`. Settle the exact path, for example a reference under `docs/` beside the user guide `docs/guides/user/email-routing.md`, in planning, and have the guide link to it rather than repeat grammar.

### Verification

Every grammar element the parser accepts appears in the specification, checked against `parser.test.ts`; the guide and source note link to it; documentation gates pass.

### Intake authority

Captured on 18 October 2026 under the deploying owner's CAPTURE-RECORDS answer, "Phases 0-1 only", with the SPEC-HOME answer folded in. The horizon is the capturing agent's placement, not the owner's. Capture grants no priority, Ready transition, implementation, acceptance or publication authority, and does not itself move the specification.
