---
id: MCP-M365-TOOL-001
title: Add reply and reply-all
theme: tool-surface
horizon: next
status: open
blocks: []
blocked-by: []
baseline-ref: null
---

## Context

Add reply and reply-all operations.

## Boundary

Keep the work limited to the stated surface.

## Current state

`src/tools/email/index.ts` registers seven email tools and none of them replies to an existing message. `handleSendEmail` in `src/main/email/send.ts` always composes a fresh message and posts it to `me/sendMail`, so it has no notion of an originating message and cannot preserve conversation threading. Microsoft Graph's `me/messages/{id}/reply` and `me/messages/{id}/replyAll` actions are unused anywhere in `src/`.

## Steps

1. Add `src/main/email/reply.ts` with a handler that takes the originating message ID and a comment body, and calls the Graph `reply` or `replyAll` action so Graph derives the recipients, subject prefix, and threading headers rather than the server re-deriving them.
2. Decide and document which caller-supplied fields are forwarded into Graph's optional `message` override (additional recipients, importance, body content type) and reject the rest, so the tool's contract is explicit rather than pass-through.
3. Re-export the handler from `src/main/email/index.ts` and register the tool in `src/tools/email/index.ts` using `graphIdSchema` for the message ID and the `WRITE_REMOTE` annotation preset, matching `m365_email_message_send`.
4. Add handler tests covering the success path plus the missing-ID and `Authentication required` branches that every other email handler already handles, to hold the repository's 100% coverage thresholds.
5. Add the new tool to the Outlook table under README's Available Tools.

## Files touched

- `src/main/email/reply.ts` (new) and `src/main/email/index.ts` re-export
- `src/tools/email/index.ts` tool registration
- `src/main/email/email-handlers.test.ts` or a new sibling test file
- `README.md` Available Tools

## Verify

1. `bun run test`
2. `bun run test:coverage`
3. `bun run build`
4. `ki repo audit --repo .`

## Dependencies / blocks

This item is not blocked and its frontmatter records no dependency. It is the first of the mail-composition set (TOOL-001 to TOOL-004) and establishes the message-scoped composition pattern — an existing message ID plus a comment body — that forwarding and the draft variants reuse. Sequencing it first is a preference, not a hard constraint: nothing in the current code makes the other three items unimplementable on their own.

## Discussion

### Letting Graph own the threading

The reason to call Graph's `reply`/`replyAll` actions rather than reconstruct a reply through the existing `me/sendMail` path is that recipient derivation, subject prefixing, and the `In-Reply-To`/`References` headers are exactly the parts a hand-rolled reply gets wrong. `send.ts` builds its payload from scratch and has no access to the original message, so reusing it would mean fetching the original and reimplementing that logic.

### Reply-all as a flag or a separate tool

Graph exposes `reply` and `replyAll` as distinct actions. Whether the server surfaces them as one tool with a boolean or as two tools is unsettled; a single tool keeps the surface small, while two tools make the more consequential reply-all an explicitly named action in the audit log. The decision affects tool naming and should be made before registration.
