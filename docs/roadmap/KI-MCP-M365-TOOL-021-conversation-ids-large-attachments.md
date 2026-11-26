---
id: KI-MCP-M365-TOOL-021
area: TOOL
title: Conversation ids, large attachments
priority: medium
size: m
assignee: work/ki.tools
status: triage
blocks: []
blocked_by: []
baseline_ref: null
created_at: 2026-11-26T02:55:00Z
updated_at: 2026-11-26T02:55:00Z
---

# KI-MCP-M365-TOOL-021: Conversation ids, large attachments

## Goal

Every message the mail tools return carries its `conversationId`, list, read and search included, and an attachment larger than the download cap can be saved to disk rather than refused.

## Context

Kris took MAIL-GAPS a on 6 November 2026 ([legacy line](https://github.com/krisb/ki-cairn-store/blob/b759e7b4506da8df0c4ca680f577bae82f7cfe57/work-legacy/batch-01-initial/ki/ki.sop.tools/messages.md?plain=1#L7)): the email capture `ki-muninn mail import` relies on needs two gaps fixed in the mail servers. In mcp-m365 0.10.0 (4000eef) both still stand: list, read and search return no `conversationId`, which only the delta and triage paths carry (`src/main/email/delta.ts`, `src/main/triage/`), and `m365_email_attachment_get` downloads a file attachment only up to 256 KiB as base64, with no way to save a larger one. mcp-gsuite's half has landed: above its configurable cap, `gsuite_email_attachment_save` writes to disk. Captured as triage from the ki.tools reset map ([4.1](https://github.com/krisb/ki-cairn-store/blob/d28c5faeca6ddcf069354dea49e8a645a37d7efb/work/ki/ki.tools/13-reset-map.change.md#41-kisoptools-legacy-10), N11).

## Boundary

- **In:** `conversationId` on the list, read and search results; an attachment save to disk above the cap, on the pattern of mcp-gsuite's `gsuite_email_attachment_save`, under the access gate and annotations this repository's `AGENTS.md` sets.
- **Out:** sending, which the draft-only invariant forbids; the importer in `ki-muninn`.

## Discussion

**Rollout:** once it lands, MAIL-GAPS' sender, now cairn.harbour, is told along the tree. Captured as triage for Kris to adopt or cancel.
