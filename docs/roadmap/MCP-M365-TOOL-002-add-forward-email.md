---
id: MCP-M365-TOOL-002
area: TOOL
title: Add forward email
theme: tool-surface
horizon: next
status: ready
blocks: []
blocked_by: []
baseline_ref: null
created_at: 2026-07-29T00:37:05Z
updated_at: 2026-10-01T19:27:46Z
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

- [ ] Add `m365_email_message_forward` over a new handler with originating `id`, a bounded array of recipient addresses, optional bounded comment and default-true `dry_run`. Reject empty/invalid recipients and newline injection before authentication or network calls.
- [ ] Use the array input directly for Graph `toRecipients`; preserve existing send/draft comma-separated compatibility without unrelated parser extraction. Preview never POSTs; explicit execution makes one forward action and returns an accepted acknowledgment without retrying.
- [ ] Register with strict `graphIdSchema`, `WRITE_REMOTE` and standard provider/auth error handling. Do not download or recompose the original message or attachments.
- [ ] Test input bounds, preview, payload, Graph failure, authentication, access gating and registration. Update `scripts/smoke.ts` and README.

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

## Discussion

### Recipient parsing is the real shared surface

Forwarding is the first composition path that needs both an existing message ID and a caller-supplied recipient list, which is what makes the duplicated parsing in `send.ts` and `draft.ts` worth consolidating here rather than later. The current parsers differ slightly — `send.ts` requires `to`, `draft.ts` treats it as optional and filters empty addresses — so extraction needs an explicit decision about which behaviour becomes canonical.

### Attachments travel implicitly

Graph's `forward` action carries the original message's attachments without the server handling any bytes, so this item delivers a form of attachment support that TOOL-003 does not depend on and does not supersede.

### Readiness review

The new API uses an address array, so the earlier proposed extraction of legacy comma-separated parsers is unnecessary scope. The [Graph forward action](https://learn.microsoft.com/en-us/graph/api/message-forward?view=graph-rest-1.0) owns forwarding; separate attachment-upload support is not a blocker.
