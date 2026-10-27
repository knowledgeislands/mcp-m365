---
id: KI-MCP-M365-TOOL-018
area: TOOL
title: Extract and distribute core
kind: deliver
horizon: hold
hold:
  reason: waiting-for
  condition: until Kris resumes Humans not Robots work, when hnr.email-routing chooses a horizon afresh (EMAIL-OWNER, Kris, 20 October)
status: draft
blocks: []
blocked_by: []
baseline_ref: null
created_at: 2026-10-18T00:19:30Z
updated_at: 2026-10-20T04:29:10Z
---

> **Idea, not on the roadmap.** Put the routing engine's provider-free parts behind a small provider port so a second mail provider can reuse them; the Humans Not Robots email-routing thread's work. Moved out of `docs/roadmap/` on 27 October 2026 under the roadmap sweep, with its record kept in full here so that it can return when Kris brings it back; it was `KI-MCP-M365-TOOL-018`.

## Goal

The routing engine's provider-free parts sit together behind a small provider port, so a second mail provider can reuse them without carrying Graph code, and Outlook routing behaves exactly as before. Another mail server can then take an exact, verifiable revision of that core and know when its copy is out of date.

## Context

The [Gmail routing design](/Users/krisbrown/workspaces/humans-not-robots/hnr-principal/+/_WORK/hnr.email-routing/design/2026-10-17-gmail-routing-design.md) finds the engine about 80% mailbox-neutral already: `parser.ts`, `matcher.ts`, `lint.ts`, `folders.ts` and `lookups.ts` are pure, and the provider-free parts of `run.ts`, `tracking.ts` and `drift.ts` can join them. The Graph-specific layer is thin: `graph-ops.ts`, `message.ts` and `utils/kql.ts`. This is the design's phase 0 work in this repository, its task 1.

The design's task 3 then publishes a manifest of the core's source revision and SHA-256 digests for vendored consumers, following the `ki-repo-mcp` shared-code precedent that `mcp-m365` and `mcp-gsuite` already use for their access-gate code. Neither server is published to a package registry; both are Git source built locally.

The port the design proposes: list messages in a location, look up a message, list a thread, search Sent, report the owner, apply a planned action and list attachments. Two engine changes make it clean: a neutral `calendarMethod` on `EmailRecord` in place of Outlook's `messageClass` and `@odata.type`, with Gmail's invitation subject prefixes added to the fallback; and a configurable triage root in place of the `_TRIAGE` constant, with the adapter supplying the message identity key.

## Boundary

A refactor with no behaviour change: every existing test and the replay fixture pass unchanged, and scheduled routing runs as before. Land it between scheduled runs, and only once the deploying owner's first-phase shadow runs are under way.

The canonical core stays in this repository (ENGINE-HOME, answered 18 October 2026): this record gathers it into one provider-free directory behind the port, and that directory is the canonical copy other servers vendor. Keep the directory self-contained, with no import out of it except through the port, so it can be vendored as a unit.

The core is distributed by vendoring: `mcp-gsuite` takes a byte-identical copy. The source side belongs here as the second part of this record: a manifest of the core's source revision and per-file SHA-256 digests in the `ki-repo-mcp` shared-code format, and a check here that fails when the manifest is stale against the core directory. The consumer side, the vendored copy and its drift check, is [KI-MCP-GSUITE-TOOL-008](/Users/krisbrown/workspaces/knowledge-islands/mcp-gsuite/docs/ideas/KI-MCP-GSUITE-TOOL-008-consume-the-routing-core.md). No separate repository or pinned Git reference is created; that waits until a third provider appears.

Publishing to any package registry needs the owner's explicit approval and is outside this record.

## Shaping

- **Approach:** gather the pure modules and the provider-free parts of the run, tracking and drift layers into one provider-free directory; define the port; add `calendarMethod` and the configurable triage root; keep the Graph adapter thin. Then generate the manifest from the core directory in the shared-code format, add a stale-manifest check to the gates, and name the revision consumers vendor from.
- **Dependencies:** the deploying owner's first-phase shadow runs under way; KI-MCP-M365-TOOL-010 accepted, so its changes are not rebased across the move.
- **Open decisions:** none.
- **Promotion to Next:** the dependencies above hold, and a quiet window between scheduled runs is chosen.

## Hold

Held until a Project opens to own email routing (LANE-OWNERS, Kris, 19 October). Kris answered LANE-OWNERS a) on 19 October 2026: the email-routing draft records in mcp-m365 and mcp-gsuite wait in one hold until a Project opens to own them. The record was at `horizon: soon` before the hold; release chooses a horizon afresh once that Project exists.

Re-validated on 20 October 2026 under TO-DONE: the hold stays. Kris answered EMAIL-OWNER on 20 October ("if that's all to do with H and R, it can go to the H and R area"), so the Project the condition waited for exists, [hnr.email-routing](/Users/krisbrown/workspaces/humans-not-robots/hnr-principal/+/_WORK/hnr.email-routing/work.md), and owns these records; that Project is itself paused until Kris resumes Humans not Robots work, which is now the release condition.

## Discussion

### Port shape

Keep the port to the seven calls above and let each adapter own its provider's identity, search syntax and action mapping. Graph keeps subject, sender and received time as identity because moves reissue ids.

### Verification

Full gates; replay against the example rule fixture; an import check that nothing in the core directory reaches Graph, the network or the clock. A consumer-side check reproduces the manifest's digests from a clean checkout of the named revision.

### Vendoring

Reuse the shared-code manifest format rather than a second one, and add the check that fails when the manifest is stale against the core directory.

### Engine home

The owner answered ENGINE-HOME with option a) on 18 October 2026 (Decision 21 in the email-routing thread's [decisions](/Users/krisbrown/workspaces/humans-not-robots/hnr-principal/+/_WORK/hnr.email-routing/decisions.md)): the canonical engine stays in `mcp-m365` in a provider-free directory behind a provider port, vendored into `mcp-gsuite` with a SHA-256 manifest and a drift check. A separate repository waits until a third provider appears.

### Intake authority

Captured on 18 October 2026 under the deploying owner's CAPTURE-RECORDS answer, "Phases 0-1 only", which asked for design tasks 1-5, 8 and 9 as drafts. The horizon is the capturing agent's placement, not the owner's. Capture grants no priority, Ready transition, implementation, acceptance or publication authority.

### Merge, 20 October

KI-MCP-M365-TOOL-020, distributing the routing core (the design's task 3), was merged into this record on 20 October 2026 under SWEEP-MERGE a) in Knowledge Islands Principal `+/_WORK/ki.ways-of-working/decisions.md`. Kris: "I agree with sweep merge". This record takes its goal, steps and decisions; TOOL-020 is cancelled as merged.
