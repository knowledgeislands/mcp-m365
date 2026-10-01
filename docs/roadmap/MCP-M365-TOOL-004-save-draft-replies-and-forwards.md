---
id: MCP-M365-TOOL-004
area: TOOL
title: Save draft replies
theme: tool-surface
horizon: next
status: awaiting-review
blocks: []
blocked_by: []
baseline_ref: 328b8269cc4c7491d0008014099752ad4ea914b7
created_at: 2026-07-29T00:37:05Z
updated_at: 2026-10-01T20:52:04Z
---

## Goal

Callers can create reviewable replies, reply-all messages and forwards as Outlook drafts while preserving the original quoted content and never sending them.

## Context

Add operations to save draft replies and forwarded messages.

## Boundary

Create reviewable message-scoped drafts only. No send operation, arbitrary message-body replacement, PATCH editor or attachment upload.

## Current state

`handleDraftEmail` creates standalone drafts through `me/messages`. No createReply/createReplyAll/createForward endpoints are used. Existing Graph authentication, ID schema and Mail.ReadWrite diagnostic can be reused.

## Steps

- [x] Add `m365_email_draft_reply`, `m365_email_draft_reply_all` and `m365_email_draft_forward`, each with originating `id`, optional bounded comment and default-true `dry_run`; draft forwarding additionally accepts a bounded recipient array.
- [x] Use the matching Graph create action with comment and recipients only, preserving Graph-provided quoted content. Do not pass both comment and message.body or perform a follow-up PATCH. Preview must not create a draft.
- [x] Return the created draft ID and subject through one shared schema and structured/text results. Register `WRITE_REMOTE` tools and retain the existing standalone draft tool unchanged.
- [x] Test all three actions, no-POST preview, missing/invalid arguments, Graph-prepared body preservation, authentication and Mail.ReadWrite failure guidance. Update exports, smoke inventory and README examples.

## Files touched

New `src/main/email/draft-actions.ts` and tests, `src/main/email/index.ts`, `src/tools/email/index.ts`, `scripts/smoke.ts`, `README.md`.

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

Explain that draft variants preserve quoted content and never send; document IDs returned for review in Outlook.

### Roadmap

Keep this item as the execution authority; record delivery and review evidence here without accepting or pruning other work.

## Review

### Delivered

Added three message-scoped draft actions at baseline `328b8269cc4c7491d0008014099752ad4ea914b7`: reply, reply-all, and forward. Each previews by default and creates an Outlook draft only on explicit `dry_run: false`.

### Change Summary

One shared handler calls Graph's `createReply`, `createReplyAll`, or `createForward` action. It sends only an optional comment and, for forwarding, 1 to 50 validated recipient addresses; it never replaces Graph-prepared quoted content or sends the draft. Strict input and shared output schemas, structured/text results, smoke inventory, README tool references, and user guidance were added. The existing standalone draft tool remains unchanged.

### Verification

`bunx tsc --noEmit`, `bun run test`, `bun run test:coverage`, `bun run build`, and `bun run ki:test:smoke` passed; coverage remained 100% across statements, branches, functions, and lines. Mocked tests cover all three endpoints, preview without POST, bounded and invalid inputs, body-preserving payloads, missing draft IDs, authentication and permission failures, and access-level visibility. Focused `ki-repo-mcp`, `ki-work-roadmap`, `ki-guides`, and `ki-authoring` audits passed. No live Graph or mailbox call was made.

### Outstanding concerns

The Graph API prepares the quoted content and returns a draft object; these offline tests cannot certify its live rendering. If a creation response lacks an ID or a request fails ambiguously, an operator must inspect Drafts before retrying to avoid a duplicate.

### Post-change review

The new tools are distinct from the send actions and standalone draft creation. The output records the created ID and subject for Outlook review, while dry-run output records no created draft. The candidate is ready for owner acceptance.

### Mini recap

Reviewable message-scoped drafts are implemented and verified offline. The item remains Awaiting review until explicit acceptance; no live message was sent or remote Git ref pushed.

## Discussion

### Draft-first is the safer default

A draft reply is reviewable before it leaves the mailbox, which makes this the lower-consequence half of the composition set even though it shares the `WRITE_REMOTE` annotation with the sending tools. Whether the server should prefer exposing draft variants and leaving the send step to a separate explicit action is worth settling across TOOL-001, TOOL-002, and this item together rather than per tool.

### Two drafting shapes in one surface

Once this lands, `m365_email_draft_create` creates standalone drafts and the new tools create message-scoped ones. Keeping them as distinct tools rather than overloading the existing one with an optional message ID keeps the required arguments honest, but it does mean the naming has to make the distinction obvious to a model choosing between them.

### Readiness review

The initial contract supplements provider-prepared quoted content with comment; body replacement and follow-up editing are excluded. The [createReply contract](https://learn.microsoft.com/en-us/graph/api/message-createreply?view=graph-rest-1.0) supports this bounded path. Draft creation is independently executable and may precede send-side reply/forward work.
