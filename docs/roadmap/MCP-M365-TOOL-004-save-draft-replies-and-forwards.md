---
id: MCP-M365-TOOL-004
title: Save draft replies and forwards
theme: tool-surface
horizon: next
status: open
blocks: []
blocked-by: []
baseline-ref: null
---

## Context

Add operations to save draft replies and forwarded messages.

## Boundary

Keep the work limited to the stated surface.

## Current state

`handleDraftEmail` in `src/main/email/draft.ts` is the only drafting path and it creates standalone drafts: it posts a freshly built message object to `me/messages` and has no originating-message parameter, so a draft it creates cannot be a reply or a forward. Graph's `createReply`, `createReplyAll`, and `createForward` actions — which return a pre-populated draft the caller then edits and sends — are not used anywhere in `src/`. The handler already carries a specific 403 diagnostic pointing at the `Mail.ReadWrite` scope, which is the scope the draft variants need too.

## Steps

1. Add handlers over `me/messages/{id}/createReply`, `createReplyAll`, and `createForward` that return the created draft's ID and subject, matching what `handleDraftEmail` reports today.
2. Decide how the draft body is populated. Graph's create actions accept a comment and prefill the quoted original, so the tool must state whether a caller-supplied body replaces or supplements that prefill, and whether a follow-up `PATCH` on the returned draft is part of this item.
3. Re-export from `src/main/email/index.ts` and register in `src/tools/email/index.ts` with `graphIdSchema` for the originating message ID and the `WRITE_REMOTE` annotation preset, matching `m365_email_draft_create`.
4. Add handler tests covering the success path, the missing-ID rejection, the `Authentication required` branch, and the `Mail.ReadWrite` 403 diagnostic already established in `draft.ts`.
5. Add the new tools to the Outlook table under README's Available Tools.

## Files touched

- `src/main/email/draft.ts` or a new sibling module, plus the `src/main/email/index.ts` re-export
- `src/tools/email/index.ts` tool registration
- `src/main/email/email-handlers.test.ts` or a new sibling test file
- `README.md` Available Tools

## Verify

1. `bun run test`
2. `bun run test:coverage`
3. `bun run build`
4. `ki repo audit --repo .`

## Dependencies / blocks

This item is not blocked and its frontmatter records no dependency. It is the draft-producing counterpart to TOOL-001 and TOOL-002 over the same Graph message actions, so implementing it after them lets the two share one decision about which caller fields override Graph's prefill. It is independently implementable: the `createReply`/`createForward` actions do not require the send-side `reply`/`forward` actions to exist.

## Discussion

### Draft-first is the safer default

A draft reply is reviewable before it leaves the mailbox, which makes this the lower-consequence half of the composition set even though it shares the `WRITE_REMOTE` annotation with the sending tools. Whether the server should prefer exposing draft variants and leaving the send step to a separate explicit action is worth settling across TOOL-001, TOOL-002, and this item together rather than per tool.

### Two drafting shapes in one surface

Once this lands, `m365_email_draft_create` creates standalone drafts and the new tools create message-scoped ones. Keeping them as distinct tools rather than overloading the existing one with an optional message ID keeps the required arguments honest, but it does mean the naming has to make the distinction obvious to a model choosing between them.
