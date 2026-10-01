---
id: MCP-M365-FND-003
title: Review conformance audit
area: FND
theme: foundation-tooling
horizon: next
status: ready
blocks: []
blocked_by: []
baseline_ref: null
created_at: 2026-09-04T08:54:20Z
updated_at: 2026-10-01T19:27:46Z
---

## Goal

Give the owner an evidence-backed recommendation for each retained conformance concern, distinguishing remaining work from repairs already delivered and explicitly recording missing historical evidence.

## Context

The estate audit reported unresolved repository-standard and Decision Records findings.

## Boundary

Investigate the named historical conformance concerns and prepare an evidence-backed recommendation. No code fixes, remote setting changes, acceptance, disposition or pruning.

## Current state

The retained item reports historical repository-standard and Decision Records findings. Its September pickup checkpoint records later mechanical audit passes, but contains no original finding IDs or acceptance criteria. Passing current audits cannot reconstruct missing historical judgment evidence.

## Steps

- [ ] Inventory each historical concern separately; search repository history, retained decisions and local audit evidence for the original rule, finding ID, observed fact and acceptance criterion. Mark unrecoverable evidence explicitly rather than inventing it.
- [ ] Run fresh focused `ki-repo`, `ki-decision-records`, `ki-git` and `ki-work-roadmap` audits and inspect the source supporting each relevant finding. Read GitHub metadata only if a concern requires it and authenticated read access is available; record unavailable remote evidence as unknown.
- [ ] Write a concern-by-concern assessment in this record with source locations, current observation, remaining gap and proposed repair/defer/exception decision. Distinguish mechanical passes, judgment findings and historical unknowns.
- [ ] Present the assessment for owner review. Capture any substantive remediation through the normal roadmap intake process; do not implement fixes or self-dispose historical concerns under this investigation.

## Files touched

This canonical roadmap record only; new remediation intake records only if concrete residual work is discovered and captured through `ki-next`.

## Verify

Run the named focused audits and `ki-authoring`; retain exact commands, exit outcomes and finding identities. Every historical concern must have cited evidence or an explicit unknown and a proposed disposition. No source code or repository setting may change in this investigation.

## Dependencies / blocks

No build-order dependency for the investigation. Missing historical or remote evidence is a reportable result, not an excuse to claim the concern resolved.

## Documentation impact

### Decision Records

Inspect existing decisions; no adoption, exception or new policy Decision Record is authorized by this review.

### Specifications

No behavior changes; record any residual contract gap as proposed follow-on work.

### Guides

No operator guide change: deliver the assessment in the work record; later approved remediation owns any guide updates.

### Roadmap

Keep this item as the execution authority; record delivery and review evidence here without accepting or pruning other work.

## Discussion

Review the evidence before deciding whether to repair, defer, or document an exception.

### Pickup checkpoint — 2026-09-27

At inspected local `main` `2e651e5f8b225be7a1d299e3a7f15ac5289ffe64`, `ki repo audit --skill ki-repo --repo .` reported PASS (including selected `ki-authoring`, `ki-git`, and `ki-repo`), and `ki repo audit --skill ki-decision-records --repo .` reported PASS. The item's historical unresolved-finding claim is not a current focused audit result; the exact original finding identities and acceptance criteria are unavailable in this record, so these passes do not prove that every former concern was resolved. No review discussion, remediation choice, or owner disposition has been accepted. Before resuming review or implementation, reconcile the destination branch, linked tasks, and retained worktrees, then recover the historical finding evidence and decide which concerns still require action. This checkpoint is pickup guidance, not an execution block or authority grant; absent evidence does not release any owner or lift a hold. This audit leaves `future`/`draft` unchanged; later closure requires review and explicit owner acceptance, with the done record retained until explicit prune selection.

### Readiness review

The approved planning boundary is an evidence reconciliation and recommendation. It does not pre-approve repairs, exceptions or terminal dispositions. Existing pickup evidence remains historical, not a current result.
