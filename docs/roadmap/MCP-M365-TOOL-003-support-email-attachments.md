---
id: MCP-M365-TOOL-003
area: TOOL
title: Support email attachments
theme: tool-surface
horizon: next
status: awaiting-review
blocks: []
blocked_by: []
baseline_ref: 05b4c65836249e401564eafa4af4d64085dc8172
created_at: 2026-07-29T00:37:05Z
updated_at: 2026-10-01T21:25:00Z
---

## Goal

Callers can inspect attachment metadata, retrieve explicitly requested small files, and attach bounded file content to standalone messages and drafts without granting filesystem access.

## Context

Support attachment download and sending messages with attachments.

## Boundary

Deliver bounded general attachment metadata, small file downloads and inline attachments on standalone send/draft. No upload sessions, arbitrary filesystem access, OneDrive coupling, item-attachment expansion or triage-saver redesign.

## Current state

General email tools expose hasAttachments but no list/get attachment tools or outbound attachments. A separate, delivered triage-only PDF saver exists under `src/main/attachments/save.ts` and uses configured roots; the older claim that the server has no filesystem surface is obsolete. The current Graph JSON helper buffers responses without a byte limit.

## Steps

- [x] Add `m365_email_attachments_list` returning bounded metadata pages and `m365_email_attachment_get` returning explicitly requested base64 file bytes only. Preserve an opaque continuation reference validated against the configured Graph host; listing must never return contentBytes.
- [x] Bound attachment transport with an optional response-byte ceiling in the Graph helper, used by these calls. Use a 256 KiB decoded inline-download cap, validate metadata before fetch and decoded bytes afterward, and stop oversized responses while streaming. Expose unsupported item/reference attachment types as metadata with a clear unsupported-download error.
- [x] Extend standalone send/draft schemas with at most 10 file attachments supplied as validated base64 arguments, each with name and MIME type. Cap decoded bytes at 2 MiB per file and 2 MiB aggregate; cap serialized Graph request bytes below 4,000,000, including message body and base64 overhead. Validate before authentication/network; no arbitrary host paths or OneDrive fetches.
- [x] Use fileAttachment payloads in the existing composition handlers; retain behavior when attachments are omitted. Do not add upload sessions or broaden the PDF-saving action. Suppress attachment content from audit logging and errors and label returned bytes as untrusted data.
- [x] Test metadata-only listing and pagination, unknown attachment kinds, malformed base64, pre/post-fetch size enforcement, streaming abort, payload-size overflow, authorization failures and unchanged send/draft behavior. Update registrations, smoke inventory and README limits.

## Files touched

New `src/main/email/attachments.ts` and tests; `src/main/email/send.ts`, `draft.ts`, `index.ts` and existing handler tests; `src/tools/email/index.ts`; `src/main/graph-client/index.ts` and tests for bounded response support; `src/utils/audit-log.ts` and tests if redaction fields need extending; `scripts/smoke.ts`; `README.md`. Existing triage saver stays behaviorally unchanged.

## Verify

Run `bunx tsc --noEmit`, `bun run test`, `bun run test:coverage`, `bun run build`, `bun run ki:test:smoke`, then focused `ki repo audit --skill ki-repo-mcp --repo .` and `ki repo audit --skill ki-work-roadmap --repo .` sequentially. Use isolated fixtures and mocked provider calls; no live account operation is part of verification. Boundary tests must use exact byte counts around each cap; no attachment content may appear in audit fixtures or exception text.

## Dependencies / blocks

No build-order blocker. Serialize edits to shared tool registration and smoke inventories with sibling mail items; landing order is a coordination preference, not a dependency.

## Documentation impact

### Decision Records

Record the bounded base64-only first delivery and data-exposure limits in a Decision Record because the choice governs future attachment and upload-session extensions.

### Specifications

Update tool schemas and regression assertions as the executable contract; this repository has no separate declared specification surface.

### Guides

Document inline limits, supported fileAttachment type, untrusted-data treatment and explicit rejection of larger uploads. Distinguish general attachment tools from the existing triage PDF action.

### Roadmap

Keep this item as the execution authority; record delivery and review evidence here without accepting or pruning other work.

## Review

### Delivered

Implemented bounded general mail attachments for MCP-M365-TOOL-003 at baseline `05b4c65836249e401564eafa4af4d64085dc8172`. The work is ready for owner review; no live mailbox call was made.

### Change Summary

Added metadata-only attachment listing with a same-message, Graph-host-pinned continuation; explicit small-file download with pre/post-fetch checks and bounded response streaming; and validated base64 attachments for standalone send and draft. Added audit redaction, strict result schemas, 44-tool smoke inventory, user guidance, and [XDR-MCP-M365-001](../decisions/XDR-MCP-M365-001-bounded-email-attachment-transport.md). The existing PDF routing saver and message-scoped reply/forward actions remain outside this surface.

### Verification

`bunx tsc --noEmit`, `bun run test`, `bun run test:coverage` (100% line, branch, function, and statement coverage), `bun run build`, and `bun run ki:test:smoke` passed. Focused `ki-engineering`, `ki-repo-mcp`, `ki-work-roadmap`, `ki-decision-records`, and `ki-guides` audits passed. Tests cover Graph metadata isolation, file type and size rejection, streamed response abort, base64 and request limits, authorization errors, unchanged text-only composition, and audit redaction. The modern and legacy MCP smoke paths see 44 tools. No live Microsoft Graph operation was authorised or run.

### Outstanding concerns

No live Graph attachment behavior is claimed. Files larger than the selected inline/download limits, item/reference attachment download, upload sessions, filesystem paths, and OneDrive coupling require separate decisions and work. A current Graph response can change between metadata and bytes requests; the implementation rejects inconsistent metadata rather than returning an unverified file.

### Post-change review

The new read tools are annotated `READ_ONLY_REMOTE`; composition remains at the existing write level. Content bytes appear only in an explicitly requested download or a caller-supplied send/draft request, never in a metadata page or audit arguments. Parsing and Graph error bodies are suppressed on attachment calls. The change stays within the approved boundary.

### Mini recap

General small-file attachment workflows are implemented and verified offline. The owner can review this packet for acceptance; live provider behavior remains an explicit later check.

## Discussion

### Attachment byte transport

Use bounded base64 arguments for outbound files, keeping the first delivery independent of filesystem and OneDrive authority. Enforce decoded per-file and aggregate limits plus the serialized request-size limit before network calls. Download content is separately bounded, explicitly requested, labelled untrusted, and excluded from audit/error payloads.

### Reading attachments is a separate risk surface from reading mail

Attachment bytes remain untrusted source data. Metadata listing returns no bytes; the download operation returns only an explicitly requested small file as base64, with an untrusted-data label and strict byte limits. It neither interprets content nor claims that base64 sanitizes the underlying material.

### Pickup checkpoint — 2026-09-27

At inspected local `main` `2e651e5f8b225be7a1d299e3a7f15ac5289ffe64`, verified partial delivery outside this item's general mail-tool surface: `2b4a1ece73f284ec6f92fafcabf6feb858602e4f` added `makeAttachmentSaver` in `src/main/attachments/save.ts`, which lists and fetches non-inline PDF attachments for the triage engine's `save-attachments:` rule action; `1b5e322246f58588ba6806de80ba852039dabfb6` moved destinations into the rule note, constrained by configured attachment roots. `src/main/triage/graph-ops.ts` invokes that action, and `docs/guides/user/email-routing.md` documents its PDF-only, 25 MB-per-attachment boundary. This is a narrow rule-driven save path, not the requested caller-facing list/download tools or attachment support in `src/main/email/send.ts` and `src/main/email/draft.ts`; every Step above remains open. The existing `src/main/attachments/save.test.ts` and triage tests are source evidence only: this audit's `bun run test` attempt was blocked by sandbox `EPERM` writing `node_modules/.vite-temp`; no fresh test, coverage, build, smoke, or live Graph result is claimed. Before implementation, reconcile the destination branch, linked tasks, and retained worktrees. This checkpoint is pickup guidance, not an execution block or authority grant; absent evidence does not release any owner or lift a hold. This audit leaves `next`/`draft` unchanged; later lifecycle transitions follow normal gates, and closure requires verified delivery, independent review of the exact candidate, explicit owner acceptance, and retention until an explicit prune selection.

### Readiness review

The earlier 4 MiB mail-inline claim was incorrect: Microsoft describes [upload sessions for 3 MB to 150 MB attachments](https://learn.microsoft.com/en-us/graph/api/attachment-createuploadsession?view=graph-rest-1.0). The selected 2 MiB aggregate inline budget is deliberately below that boundary and includes a separate request-size guard. No new filesystem authority is introduced.
