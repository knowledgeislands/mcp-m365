---
id: MCP-M365-TOOL-002
area: TOOL
title: Add forward email
theme: tool-surface
horizon: next
status: awaiting-review
blocks: []
blocked_by: []
baseline_ref: ab597c4b7d74deb355f5cfbf1f66c705762d3e80
created_at: 2026-07-29T00:37:05Z
updated_at: 2026-10-01T20:56:26Z
---

## Goal

Callers can preview and explicitly forward an existing message to validated recipients without downloading and recomposing its original content.

## Context

Add email forwarding.

## Boundary

Add one previewable forward action. Preserve old send/draft recipient parsing; no compose refactor, attachment byte handling or automatic retry.

## Current state

`send.ts` and `draft.ts` create standalone messages; no forward action exists. Their comma-separated recipient parsers differ in empty-address handling. The forwarding endpoint can keep provider-owned original content without downloading it.

## Steps

- [x] Add `m365_email_message_forward` over a new handler with originating `id`, a bounded array of recipient addresses, optional bounded comment and default-true `dry_run`. Reject empty/invalid recipients and newline injection before authentication or network calls.
- [x] Use the array input directly for Graph `toRecipients`; preserve existing send/draft comma-separated compatibility without unrelated parser extraction. Preview never POSTs; explicit execution makes one forward action and returns an accepted acknowledgment without retrying.
- [x] Register with strict `graphIdSchema`, `WRITE_REMOTE` and standard provider/auth error handling. Do not download or recompose the original message or attachments.
- [x] Test input bounds, preview, payload, Graph failure, authentication, access gating and registration. Update `scripts/smoke.ts` and README.

## Files touched

New `src/main/email/forward.ts` and tests, `src/main/email/index.ts`, `src/tools/email/index.ts`, `scripts/smoke.ts`, `README.md`.

## Verify

Run `bunx tsc --noEmit`, `bun run test`, `bun run test:coverage`, `bun run build`, `bun run ki:test:smoke`, then focused `ki repo audit --skill ki-repo-mcp --repo .` and `ki repo audit --skill ki-work-roadmap --repo .` sequentially. Use isolated fixtures and mocked provider calls; no live account operation is part of verification.

## Dependencies / blocks

No build-order blocker. Serialize edits to shared tool registration and smoke inventories with sibling mail items; landing order is a coordination preference, not a dependency.

## Documentation impact

### Decision Records

No new architectural choice is required; follow the existing injected configuration and access-gating decisions.

### Specifications

Update tool schemas and regression assertions as the executable contract; this repository has no separate declared specification surface.

### Guides

Document forward recipients, preview and accepted-for-delivery semantics.

### Roadmap

Keep this item as the execution authority; record delivery and review evidence here without accepting or pruning other work.

## Review

### Delivered

Added `m365_email_message_forward` at baseline `ab597c4b7d74deb355f5cfbf1f66c705762d3e80`. Callers can preview a forward and explicitly send it to validated recipients without downloading or rebuilding the original message.

### Change Summary

The handler accepts one original message ID, 1 to 50 email addresses, an optional bounded comment, and default-true `dry_run`. It rejects invalid or newline-containing addresses before authentication. Preview performs one metadata GET; explicit effect performs one Graph `/forward` POST with top-level `toRecipients` and no retry. The tool uses strict ID/schema validation and `WRITE_REMOTE`. Smoke inventory, README, access-level counts, and the user guide were updated; existing send/draft parsers were untouched.

### Verification

`bunx tsc --noEmit`, `bun run test`, `bun run test:coverage`, `bun run build`, and `bun run ki:test:smoke` passed. The suite passed 1,096 tests with 100% coverage on all four metrics; smoke listed 42 tools. Mocked tests cover bounds, preview, exact payload, provider/auth errors, access visibility, and registration. Focused `ki-repo-mcp`, `ki-work-roadmap`, `ki-guides`, and `ki-authoring` audits passed. No live Microsoft Graph or mailbox call was made.

### Outstanding concerns

HTTP acceptance is not proof of delivery. An ambiguous failure must be checked in Sent Items before retrying; the server does not automatically retry. Graph owns original content and attachments in the forward action, so live rendering has not been certified by these offline tests.

### Post-change review

The input cannot override message body or headers, and the forward result does not claim delivery. The action is distinct from the reviewable forward-draft tool and requires an explicit `dry_run: false` to send. Ready for owner acceptance of this candidate.

### Mini recap

The additive forward action is delivered and verified offline, with no live send or remote Git push. The item remains Awaiting review until explicit acceptance.

## Discussion

### Recipient parsing is the real shared surface

Forwarding is the first composition path that needs both an existing message ID and a caller-supplied recipient list, which is what makes the duplicated parsing in `send.ts` and `draft.ts` worth consolidating here rather than later. The current parsers differ slightly — `send.ts` requires `to`, `draft.ts` treats it as optional and filters empty addresses — so extraction needs an explicit decision about which behaviour becomes canonical.

### Attachments travel implicitly

Graph's `forward` action carries the original message's attachments without the server handling any bytes, so this item delivers a form of attachment support that TOOL-003 does not depend on and does not supersede.

### Readiness review

The new API uses an address array, so the earlier proposed extraction of legacy comma-separated parsers is unnecessary scope. The [Graph forward action](https://learn.microsoft.com/en-us/graph/api/message-forward?view=graph-rest-1.0) owns forwarding; separate attachment-upload support is not a blocker.
