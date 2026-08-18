---
id: MCP-M365-TOOL-002
area: TOOL
title: Add forward email
theme: tool-surface
horizon: next
status: draft
blocks: []
blocked_by: []
baseline_ref: null
---

## Goal

Achieve the stated outcome: Add forward email.

## Context

Add email forwarding.

## Boundary

Keep the work limited to the stated surface.

## Current state

No forwarding path exists. Graph's `me/messages/{id}/forward` action is not called anywhere in `src/`, and the only outbound composition paths are `handleSendEmail` (`src/main/email/send.ts`, posting to `me/sendMail`) and `handleDraftEmail` (`src/main/email/draft.ts`, posting to `me/messages`). Both parse recipients the same way — split a comma-separated string, trim, and wrap each address as `{ emailAddress: { address } }` — and that logic is duplicated between the two files rather than shared.

## Steps

- [ ] Add `src/main/email/forward.ts` with a handler that takes the originating message ID, a recipient list, and an optional comment, and calls Graph's `forward` action so the original body and attachments travel with the message.
- [ ] Extract the duplicated comma-separated recipient parsing out of `send.ts` and `draft.ts` into a shared helper the new handler also uses, instead of adding a third copy.
- [ ] Re-export the handler from `src/main/email/index.ts` and register the tool in `src/tools/email/index.ts` with `graphIdSchema` for the message ID and the `WRITE_REMOTE` annotation preset.
- [ ] Add handler tests for the success path, the missing-ID and missing-recipient rejections, and the `Authentication required` branch, and extend the existing send/draft tests to cover the extracted helper.
- [ ] Add the new tool to the Outlook table under README's Available Tools.

## Files touched

- `src/main/email/forward.ts` (new) and `src/main/email/index.ts` re-export
- `src/main/email/send.ts` and `src/main/email/draft.ts` for the shared recipient-parsing helper
- `src/tools/email/index.ts` tool registration
- `src/main/email/email-handlers.test.ts` or a new sibling test file
- `README.md` Available Tools

## Verify

1. `bun run test`
2. `bun run test:coverage`
3. `bun run build`
4. `ki repo audit --repo .`

## Dependencies / blocks

This item is not blocked and its frontmatter records no dependency. It belongs to the same mail-composition set as TOOL-001 and shares its message-scoped shape, so doing it after TOOL-001 avoids inventing the recipient-parsing helper twice. The relationship is a sequencing preference only; forwarding does not require reply to exist.

## Documentation impact

### Decision Records

None.

### Specifications

None.

### Guides

Update the README tool catalogue with forward-email behaviour.

### Roadmap

No additional roadmap impact.

## Discussion

### Recipient parsing is the real shared surface

Forwarding is the first composition path that needs both an existing message ID and a caller-supplied recipient list, which is what makes the duplicated parsing in `send.ts` and `draft.ts` worth consolidating here rather than later. The current parsers differ slightly — `send.ts` requires `to`, `draft.ts` treats it as optional and filters empty addresses — so extraction needs an explicit decision about which behaviour becomes canonical.

### Attachments travel implicitly

Graph's `forward` action carries the original message's attachments without the server handling any bytes, so this item delivers a form of attachment support that TOOL-003 does not depend on and does not supersede.
