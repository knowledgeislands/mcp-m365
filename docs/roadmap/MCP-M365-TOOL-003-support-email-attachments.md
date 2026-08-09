---
id: MCP-M365-TOOL-003
area: TOOL
title: Support email attachments
theme: tool-surface
horizon: next
status: draft
blocks: []
blocked-by: []
baseline-ref: null
---

## Goal

Achieve the stated outcome: Support email attachments.

## Context

Support attachment download and sending messages with attachments.

## Boundary

Keep the work limited to the stated surface.

## Current state

Attachments are visible but inaccessible. `src/main/email/read.ts` selects `EMAIL_DETAIL_FIELDS` from `src/config/index.ts`, which includes `hasAttachments`, so a read email reports whether attachments exist and nothing more; `me/messages/{id}/attachments` is never called. On the outbound side, neither `send.ts` nor `draft.ts` puts an `attachments` array on the message object it posts. The server has no filesystem read surface at all — the OneDrive upload handlers in `src/main/onedrive/` take file content as a string argument — so attachment bytes have to arrive through a tool argument or be sourced from Graph itself.

## Steps

- [ ] Add a read-only attachment listing and download path over `me/messages/{id}/attachments`, returning attachment IDs, names, content types, and sizes, with content fetched only when explicitly requested.
- [ ] Decide where outbound attachment bytes come from: a base64 tool argument, or a reference to an existing OneDrive item the server fetches. This decision governs the whole outbound design and must be settled before the schema is written.
- [ ] Add outbound attachment support to the existing composition handlers by attaching an `attachments` array to the message payload, rather than adding a parallel send path.
- [ ] Handle the size boundary. `src/main/onedrive/upload-large.ts` already establishes the pattern for the 4 MiB threshold in `ONEDRIVE_UPLOAD_THRESHOLD` using a chunked upload session; Graph mail attachments have the same inline limit and need an upload session above it. Decide whether this item ships only the inline path and rejects oversized attachments with a clear error.
- [ ] Register the tools in `src/tools/email/index.ts` — `READ_ONLY_REMOTE` for listing and download, and no new annotation for the composition changes.
- [ ] Add tests including the size-rejection and `Authentication required` branches, and document the tools and their size limit in README's Available Tools.

## Files touched

- `src/main/email/attachments.ts` (new) and `src/main/email/index.ts` re-export
- `src/main/email/send.ts` and `src/main/email/draft.ts` for outbound attachment payloads
- `src/tools/email/index.ts` tool registration
- `src/config/index.ts` if an attachment size constant is added alongside `ONEDRIVE_UPLOAD_THRESHOLD`
- `src/main/email/email-handlers.test.ts` or a new sibling test file
- `README.md` Available Tools

## Verify

1. `bun run test`
2. `bun run test:coverage`
3. `bun run build`
4. `ki repo audit --repo .`
5. An oversized attachment is rejected with an actionable message rather than a raw Graph error.

## Dependencies / blocks

This item is not blocked and its frontmatter records no dependency. It touches the same composition handlers as TOOL-001, TOOL-002, and TOOL-004, so landing it after those keeps the attachment payload change confined to one shape rather than being retrofitted into each new handler in turn. Nothing in the code forces that order.

## Discussion

### Where the bytes come from is the open question

Every other decision in this item follows from step 2. A base64 argument keeps the server self-contained but pushes potentially large payloads through the MCP transport; sourcing from OneDrive reuses the existing `src/main/onedrive/` surface and keeps bytes server-side, but couples mail composition to OneDrive and to the `Files.Read` scope. Both options are already consented for in `M365_DEFAULT_SCOPES`, so scope is not the deciding factor.

### Reading attachments is a separate risk surface from reading mail

`read.ts` sanitizes HTML bodies specifically because email content is untrusted input that can carry prompt injection. Attachment content is the same class of input with none of that handling, so a download tool needs an explicit position on what it returns and how it is labelled before it is registered.
