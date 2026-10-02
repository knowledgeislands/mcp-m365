---
id: MCP-M365-TOOL-001
area: TOOL
title: Add reply support
theme: tool-surface
horizon: next
status: done
blocks: []
blocked_by: []
baseline_ref: 36c2cc22b7d59ed6f982d1a0e26a38fde12af1b4
created_at: 2026-07-29T00:37:05Z
updated_at: 2026-10-02T02:20:58Z
---

## Goal

Callers can preview and explicitly send a reply or reply-all to an existing message while preserving provider-owned threading and recipient rules.

## Context

Add reply and reply-all operations.

## Boundary

Add explicit reply and reply-all send actions with default previews. No attachment upload, arbitrary Graph message overrides, retry loop or change to existing send behavior.

## Current state

The email surface has standalone send/draft handlers but no Graph reply or replyAll action. `GraphContext` provides injected endpoint/auth; `graphIdSchema` and access-gate presets already exist.

## Steps

- [x] Add one shared reply handler and two explicitly named tools, `m365_email_message_reply` and `m365_email_message_reply_all`. Accept only originating `id`, a bounded plain-text `comment`, and `dry_run` defaulting true; reject optional Graph message overrides in this first version.
- [x] Preview the target/action without invoking a mutation. On explicit `dry_run: false`, use Graph reply/replyAll once and return an accepted-for-delivery acknowledgment; do not imply that HTTP acceptance proves delivery or automatically retry a send.
- [x] Reuse `GraphContext.ensureAuthenticated`, strict `graphIdSchema`, standard error envelopes and `WRITE_REMOTE`. Graph owns threading and recipient derivation; reply-all is explicit in the tool name and audit event.
- [x] Test both Graph endpoints, preview making no POST, actual-send payload, rejected/missing ID, schema bounds, auth failure, provider errors and access-level visibility. Add both names to `scripts/smoke.ts` and README.

## Files touched

New `src/main/email/reply.ts` and tests, `src/main/email/index.ts`, `src/tools/email/index.ts`, `scripts/smoke.ts`, `README.md`.

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

Explain preview-first reply/reply-all semantics and the reviewable draft alternatives.

### Roadmap

Keep this item as the execution authority; record delivery and review evidence here without accepting or pruning other work.

## Review

### Delivered

Added explicit preview-first reply and reply-all actions at baseline `36c2cc22b7d59ed6f982d1a0e26a38fde12af1b4`. The caller selects the original message and plain-text comment; Graph derives recipients and threading for each action.

### Change Summary

Added one shared handler, two `WRITE_REMOTE` MCP tools with strict bounded schemas, smoke inventory entries, README tool references, and a user guide. Both tools default to a metadata-only GET preview and require `dry_run: false` for one POST. The configuration guide's write/destructive tool counts now include both actions. No existing send handler or Graph client code changed.

### Verification

`bunx tsc --noEmit`, `bun run test`, `bun run test:coverage`, `bun run build`, and `bun run ki:test:smoke` passed; coverage remained 100% on all four metrics. Mocked tests covered both action endpoints, no-POST previews, strict ID/comment/override validation, auth/provider errors, and access-level visibility. Focused `ki-repo-mcp`, `ki-work-roadmap`, `ki-guides`, and `ki-authoring` audits passed. No live Microsoft Graph call or mailbox operation was made.

### Outstanding concerns

Graph returns HTTP 202 Accepted without a delivery receipt, so an ambiguous failure cannot safely be retried automatically. The guide directs operators to inspect Sent Items and the conversation before retrying. The standalone draft tool does not guarantee threaded reply semantics; reply-specific draft work remains separately scoped.

### Post-change review

The tool names make recipient expansion visible before the caller opts into an effect. The effect path sends the caller's comment only once through Graph's documented `/reply` or `/replyAll` action, with no arbitrary recipient overrides. Ready for owner acceptance of this candidate.

### Mini recap

Reply support and its documentation are delivered and verified offline. The item remains Awaiting review until explicit acceptance; no remote Git ref was pushed.

## Done

Accepted 2026-10-02 by Kris Brown on the review packet above.

## Discussion

### Letting Graph own the threading

The reason to call Graph's `reply`/`replyAll` actions rather than reconstruct a reply through the existing `me/sendMail` path is that recipient derivation, subject prefixing, and the `In-Reply-To`/`References` headers are exactly the parts a hand-rolled reply gets wrong. `send.ts` builds its payload from scratch and has no access to the original message, so reusing it would mean fetching the original and reimplementing that logic.

### Reply-all as a flag or a separate tool

Use distinct reply and reply-all tools so the recipient-expanding action is explicit in its name and audit record. Both accept a comment and preview by default; arbitrary recipient/body overrides are outside this first delivery.

### Readiness review

Two distinct tool names make reply-all explicit. Initial scope accepts comment only and no additional recipient/body overrides. Microsoft documents the [reply action](https://learn.microsoft.com/en-us/graph/api/message-reply?view=graph-rest-1.0); HTTP acceptance is not a delivery receipt. Sending exists in the current server, but these new non-idempotent actions use a default preview.
