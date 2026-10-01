---
id: MCP-M365-TOOL-001
area: TOOL
title: Add reply support
theme: tool-surface
horizon: next
status: ready
blocks: []
blocked_by: []
baseline_ref: null
created_at: 2026-07-29T00:37:05Z
updated_at: 2026-10-01T19:30:08Z
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

- [ ] Add one shared reply handler and two explicitly named tools, `m365_email_message_reply` and `m365_email_message_reply_all`. Accept only originating `id`, a bounded plain-text `comment`, and `dry_run` defaulting true; reject optional Graph message overrides in this first version.
- [ ] Preview the target/action without invoking a mutation. On explicit `dry_run: false`, use Graph reply/replyAll once and return an accepted-for-delivery acknowledgment; do not imply that HTTP acceptance proves delivery or automatically retry a send.
- [ ] Reuse `GraphContext.ensureAuthenticated`, strict `graphIdSchema`, standard error envelopes and `WRITE_REMOTE`. Graph owns threading and recipient derivation; reply-all is explicit in the tool name and audit event.
- [ ] Test both Graph endpoints, preview making no POST, actual-send payload, rejected/missing ID, schema bounds, auth failure, provider errors and access-level visibility. Add both names to `scripts/smoke.ts` and README.

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

## Discussion

### Letting Graph own the threading

The reason to call Graph's `reply`/`replyAll` actions rather than reconstruct a reply through the existing `me/sendMail` path is that recipient derivation, subject prefixing, and the `In-Reply-To`/`References` headers are exactly the parts a hand-rolled reply gets wrong. `send.ts` builds its payload from scratch and has no access to the original message, so reusing it would mean fetching the original and reimplementing that logic.

### Reply-all as a flag or a separate tool

Use distinct reply and reply-all tools so the recipient-expanding action is explicit in its name and audit record. Both accept a comment and preview by default; arbitrary recipient/body overrides are outside this first delivery.

### Readiness review

Two distinct tool names make reply-all explicit. Initial scope accepts comment only and no additional recipient/body overrides. Microsoft documents the [reply action](https://learn.microsoft.com/en-us/graph/api/message-reply?view=graph-rest-1.0); HTTP acceptance is not a delivery receipt. Sending exists in the current server, but these new non-idempotent actions use a default preview.
