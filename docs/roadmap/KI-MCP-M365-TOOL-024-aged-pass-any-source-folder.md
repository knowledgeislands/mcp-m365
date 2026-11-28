---
id: KI-MCP-M365-TOOL-024
area: TOOL
title: Aged pass from any folder, age since read
priority: medium
size: m
assignee: work/ki.tools
status: triage
blocks: []
blocked_by: []
baseline_ref: null
created_at: 2026-11-28T02:04:00Z
updated_at: 2026-11-28T02:04:00Z
---

# KI-MCP-M365-TOOL-024: Aged pass from any folder, age since read

## Goal

An `aged` rule can name any source folder, not only a `_TRIAGE` subfolder, and can test how long mail has sat read rather than how long ago it arrived, so concluded topic mail can be moved on from a D12 folder without ever touching unread or flagged mail, deleting anything or dropping a category.

## Context

Wicket (cairn.harbour) asked on 28 November 2026 for this capture. HNR's Route Triage now files into D12 folders, and Kris agreed D12 for the HNR mailbox the same day. Plan line H40 in ki-cairn-harbour `d12/rules-hnr.toml` cannot be expressed: concluded topic mail in `D12/04 Decide` (any `HNR/` category, read and unflagged for 14 days) moves to `D12/10 Deposit`, keeping its category. In mcp-m365 0.10.0 (cd138ec) three things stand in the way:

1. **Folder scope.** `handleAgedRun` in `src/main/triage/run.ts` (lines 627–646) walks only `childPaths(map, TRIAGE_ROOT)` (line 633), the immediate children of `_TRIAGE` (`childPaths`, `src/main/triage/graph-ops.ts` lines 67–73; `TRIAGE_ROOT`, `src/main/triage/folders.ts` line 12). `referencedFolders` (`run.ts` lines 604–616) narrows that walk by comparing `folder:` values with the leaf name, and the matcher's `folder:` arm (`src/main/triage/matcher.ts` line 153) compares `record.folder`, which `toEmailRecord` sets to that leaf (`src/main/triage/message.ts` lines 46–74). The tool description (`src/tools/triage/index.ts` line 80) and the user guide (`docs/guides/user/email-routing.md` line 55) say the same. A rule naming `D12/04 Decide` therefore matches nothing.
2. **Age basis.** `age:` counts from arrival: the matcher subtracts `record.received`, Graph's `receivedDateTime` (`matcher.ts` lines 145–150; `message.ts` line 54), from `now`, and `listFolderMessages` reads each folder oldest-received first (`graph-ops.ts` lines 76–96). `TRIAGE_SELECT_FIELDS` (`message.ts` line 12) has no `lastModifiedDateTime`. Graph exposes no read time, so the nearest proxy is `lastModifiedDateTime` with `isRead: true`. That proxy is wrong whenever anything else changes the message: a category added or removed, a flag set or cleared, a move, an `untag:` by this engine, or an Outlook client touch all reset it, so a reading can only be "unchanged for N days while read", never "read N days ago".
3. **Category prefix.** `category:` matches one exact name, compared without case (`matcher.ts` lines 139–142), so "any `HNR/` category" needs every category listed as its own rule, or a prefix form.

The hard limits are expressible today as conditions (`!status:unread status:unflagged`, `move:` only) but are the rule author's to keep, since the aged block also supports `delete` and `mark:` (`src/main/triage/types.ts` line 72). A Graph move keeps a message's categories, and the aged pass's `move:` adds or removes none.

## Boundary

- **In:** `folder:` and the aged walk accepting a full folder path outside `_TRIAGE` (for example `folder:"D12/04 Decide"`), read with its own window as each `_TRIAGE` folder is now; an age-since-read test, or a clearly named `lastModifiedDateTime` proxy such as `idle:14d`, documented with what resets it; a way to match a category prefix, if planning keeps it in scope; for a source outside `_TRIAGE`, an engine guard that never acts on unread or flagged mail, allows only `move:` (no `delete`), and keeps categories, whatever the rule says; tool description, user guide, lint and fixtures updated.
- **Out:** Harbour's D12 rule file and plan line H40 themselves; any read-time tracking of the engine's own (a read-state history in the tracking cache is a separate design); changing the inbound pass's Inbox scope.

## Discussion

Whether the proxy is honest enough to ship, or whether the engine should record a first-seen-read time in its tracking cache instead, is for planning. `lookups.ts` (`src/main/triage/lookups.ts` lines 16–19 and 83–98) assumes an aged `folder:X` stands for `_TRIAGE/X` when it maps archives to their feeding folders for `thread:filed`, so a full-path `folder:` must keep that mapping right. Overlap: KI-MCP-M365-TOOL-023 adds `flag` to the general read and list tools, while the aged engine already reads flag state, so this record does not depend on it; KI-MCP-M365-TOOL-022's protected-list lookups and missing `Retry-After` handling also bound a D12 move pass, which moves in the same batches; KI-MCP-M365-TOOL-021 (`conversationId` on list, read and search) does not touch the aged engine. Blocks Harbour plan line H40. **Rollout:** once it lands, cairn.harbour is told along the tree. Captured as triage for Kris to adopt or cancel.
