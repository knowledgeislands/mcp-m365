---
id: KI-MCP-M365-TOOL-016
area: TOOL
title: Thread-follow skips disposal folders
kind: deliver
horizon: hold
hold:
  reason: waiting-for
  condition: until Kris resumes Humans not Robots work, when hnr.email-routing chooses a horizon afresh (EMAIL-OWNER, Kris, 20 October)
status: draft
blocks: []
blocked_by: []
baseline_ref: null
created_at: 2026-10-18T00:19:30Z
updated_at: 2026-10-19T23:24:19Z
---

## Goal

A reply never follows its thread into a folder the rules use to dispose of mail, so a live conversation is not deleted because an earlier message in it was junk.

## Context

Thread-follow (`move:@thread` and `thread:filed`) treats every concrete `move:` target in the inbound block as "filed", apart from the fallback's. `filedFolders` in `src/main/triage/lookups.ts` derives that set from the rule note. In one deployment the inbound block also moves noise to disposal folders, `981 Delete` and `991 Junk`, whose aged rules delete after seven days. Those count as filed today, so a genuine reply to a thread whose first message was routed to Junk follows it there and ages out.

The deploying owner chose on 18 October 2026 to keep the thread-follow line and fix this later, watching live reports meanwhile for threads sent to disposal folders.

## Boundary

Change which folders count as filed for thread-follow; nothing else in matching or the aged pass. Derive the disposal set from the rule note rather than from configured folder names, so it moves with the rules as "filed" already does. No mailbox change and no deployment.

## Shaping

- **Approach:** extend `filedFolders` so a folder the rules dispose of is never filed, derived from the rule note; a sibling found there is skipped and reported.
- **Dependencies:** none in code. If the disposal marker becomes a grammar change, it lands in the rule-language specification ([KI-MCP-M365-TOOL-019](KI-MCP-M365-TOOL-019-move-the-rule-specification.md)) as well.
- **Open decisions:** how disposal is derived (see Discussion).
- **Promotion to Next:** the derivation is chosen, and live reports have shown whether threads reach disposal folders in practice.

## Hold

Held until a Project opens to own email routing (LANE-OWNERS, Kris, 19 October). Kris answered LANE-OWNERS a) on 19 October 2026: the email-routing draft records in mcp-m365 and mcp-gsuite wait in one hold until a Project opens to own them. The record was at `horizon: soon` before the hold; release chooses a horizon afresh once that Project exists.

Re-validated on 20 October 2026 under TO-DONE: the hold stays. Kris answered EMAIL-OWNER on 20 October ("if that's all to do with H and R, it can go to the H and R area"), so the Project the condition waited for exists, [hnr.email-routing](/Users/krisbrown/workspaces/humans-not-robots/hnr-principal/+/_WORK/hnr.email-routing/work.md), and owns these records; that Project is itself paused until Kris resumes Humans not Robots work, which is now the release condition.

## Discussion

### Deriving disposal

Candidates, to settle in planning: a destination whose aged rule ends in `delete`; a `delete` inbound rule's siblings; or an explicit marker in the `destinations v1` block. The first needs no grammar change but ties the inbound meaning to the aged block, which `filedFolders` already does for archives. An explicit marker is clearer to a rule author and portable to the Gmail adapter, but is a spec change under the rule-language specification's home.

### What a skipped sibling does

A sibling in a disposal folder should be skipped and reported, as an archive fed from two folders is today, so the reply falls through to the rules below rather than being guessed at.

### Verification

Lookup tests for a thread whose only filed sibling is in a disposal folder, and for one with siblings in both a live and a disposal folder; a replay against the example rule fixture.

### Intake authority

Captured on 18 October 2026 from the deploying owner's THREAD-NOISE answer, "Keep, fix later", which asked for a draft task. The horizon is the capturing agent's placement, not the owner's. Capture grants no priority, Ready transition, implementation, acceptance or publication authority.
