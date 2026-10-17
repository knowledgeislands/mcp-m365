---
id: KI-MCP-M365-TOOL-013
area: TOOL
title: Per-rule hit counts
kind: deliver
horizon: future
status: draft
blocks: []
blocked_by: []
baseline_ref: null
created_at: 2026-10-17T13:59:45Z
updated_at: 2026-10-17T14:02:35Z
---

## Goal

The rule owner can see which rules still fire and which have not fired for months, so a long disposal list can be pruned on evidence rather than guesswork.

## Context

A mature rule note accumulates lines that no longer match anything. In one deployment, the disposal block alone holds about 180 lines and the owner intends to cut it to about 40. Lint can already report shadowed rules, which can never fire, but nothing reports rules that could fire and simply do not.

The proposal records, per rule source line, `last_hit` and `hits_90d` in the tracking file, updated by every pass that applies a rule, and adds a `stale-rule` lint finding for a rule with no hit in a configurable window.

## Boundary

Counting and reporting only. Lint never deletes or rewrites a rule; pruning stays the owner's edit to their own rule note. The server keeps no rule state beyond hit evidence in the caller-named tracking file.

## Discussion

### Identity of a rule

Source line numbers move whenever the note is edited. Key counts by a stable fingerprint of the rule's normalised text, and report the current line number alongside, so an edit above a rule does not reset its history. A rule whose text changes starts afresh, which is the honest outcome.

### Lint purity

`lint.ts` is pure. Pass the hit evidence in as data alongside the parsed rules, with `now` injected, rather than reading the tracking file inside lint.

### Verification

Tracking tests for counting and the 90-day window with an injected clock; lint tests for `stale-rule` with and without evidence, and for a rule whose line moved but text did not.

### Intake authority

Captured from an owner-approved rollout plan (phase 4). Capture grants no priority, Ready transition, implementation, acceptance or publication authority. Adopted on 17 October 2026 under the deploying owner's approved rollout, which sets the horizons and names this record's place in the sequence; adoption grants no Ready transition, acceptance or publication authority.
