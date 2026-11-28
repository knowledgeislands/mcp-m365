---
id: KI-MCP-M365-TOOL-023
area: TOOL
title: Flag state on read and list
priority: medium
size: s
assignee: work/ki.tools
status: triage
blocks: []
blocked_by: []
baseline_ref: null
created_at: 2026-11-28T01:56:00Z
updated_at: 2026-11-28T01:56:00Z
---

# KI-MCP-M365-TOOL-023: Flag state on read and list

## Goal

The message read, list and search tools return each message's follow-up flag, Graph's `flag` with its `flagStatus`, so a caller can tell flagged, complete and unflagged mail apart.

## Context

Wicket (cairn.harbour) found on 28 November 2026 that Harbour's triage Decide rule (D12) needs the flag state, and the read and list tools do not give it. In mcp-m365 0.10.0 (045a030), `src/config/index.ts` defines `EMAIL_SELECT_FIELDS` (line 77), which `m365_email_messages_list` (`src/main/email/list.ts`) and `m365_email_messages_search` (`src/main/email/search.ts`) select, and `EMAIL_DETAIL_FIELDS` (line 79), which `m365_email_message_get` (`src/main/email/read.ts`) selects; neither includes `flag`. List and search pass Graph's `items` through in `structuredContent`, so the field would surface there once selected; read returns text only and would need the flag in its formatted output. The routing engine already selects and normalises it (`TRIAGE_SELECT_FIELDS` and `FLAG_STATUS` in `src/main/triage/message.ts`), which a fix can follow.

## Boundary

- **In:** `flag` in `EMAIL_SELECT_FIELDS` and `EMAIL_DETAIL_FIELDS`; the flag status in the read tool's output and in list and search results, with the output schemas and fixtures updated.
- **Out:** setting or clearing a flag, which is a write tool of its own; Harbour's D12 rule itself.

## Discussion

Touches the same select constants as KI-MCP-M365-TOOL-021's `conversationId`, so the two may plan together. **Rollout:** once it lands, cairn.harbour is told along the tree. Captured as triage for Kris to adopt or cancel.
