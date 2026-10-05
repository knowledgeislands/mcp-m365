---
id: MCP-M365-TOOL-005
area: TOOL
title: Add scheduling helpers
theme: tool-surface
horizon: now
status: done
blocks: []
blocked_by: []
baseline_ref: 00bc15bb84e2dc1a5bc1934cb5da4734e7d49dd7
created_at: 2026-07-29T00:37:05Z
updated_at: 2026-10-05T07:43:46Z
---

## Goal

Achieve the stated outcome: Add scheduling helpers.

## Context

Add free/busy lookup and scheduling assistance.

## Boundary

Keep the work limited to the stated surface.

## Shaping

The proposed first delivery is read-only free/busy lookup through Microsoft Graph `getSchedule`, not suggested slots or calendar writes. This bounded contract needs owner approval before readiness; Future/Draft is preserved. [Microsoft's getSchedule contract](https://learn.microsoft.com/en-us/graph/api/calendar-getschedule?view=graph-rest-1.0) specifies SMTP targets, UTC response default, interval bounds of 5–1440 minutes, and delegated work/school support; delegated personal accounts are unsupported.

## Current state

`src/main/calendar/index.ts` exports event handlers, while `src/tools/calendar/index.ts` registers list/create/respond/cancel/delete operations. No availability handler exists. The injected `GraphContext`, authentication seam, `callGraphAPI` POST support and response-byte limit, existing calendar permissions, annotation presets, package calendar export, tool-registration seam, and smoke inventory can support the new slice without a new provider dependency.

### Proposed input and output

Propose `m365_calendar_availability_get` with a strict input object: `schedules` contains 1–20 valid SMTP addresses of at most 254 characters, with case-insensitive duplicates rejected; required `startDateTime` and `endDateTime` are valid UTC RFC3339 instants ending in `Z`, end follows start, and the window is at most seven days; optional integer `availabilityViewInterval` is 5–1440 minutes, default 30. The seven-day and target limits are proposed product bounds, not a claim that all are provider maxima.

Use one shared result schema for the handler and tool output: normalized UTC start/end, resolved interval, and at most 20 schedule results containing schedule identity and either a bounded provider availability view or an explicit provider error. Do not include event subjects, locations, attendees, or arbitrary provider properties; failed schedules must never appear free. Bound response bytes and availability length from the approved request limits. Return structured content plus serialized text, with existing error envelopes for execution failures. The implementation must specify and test malformed/extra/missing schedule handling before delivery.

## Steps

- [x] Approve the free/busy-only scope, UTC contract, bounds, output projection, and account restriction; retain suggestions and event mutation outside this slice.
- [x] Add typed input/result schemas and `handleGetAvailability`; independently validate direct-library inputs before authentication or network calls.
- [x] POST UTC `dateTimeTimeZone` objects to `me/calendar/getSchedule` using injected Graph context and a bounded response.
- [x] Preserve partial provider errors and reject malformed or excessive results without fabricating availability.
- [x] Register through `READ_ONLY_REMOTE` despite the HTTP POST, export the calendar handler, and update registration/smoke inventories.
- [x] Test input boundaries, exact request, partial failures, malformed response, authentication/transport failures, and privacy projection with isolated fixtures.
- [x] Document the tool and restrictions; run the stated gates and prepare a Review packet.

## Files touched

Expected scope: `src/main/calendar/availability.ts` and its test, `src/main/calendar/index.ts`, `src/tools/calendar/index.ts`, a new focused calendar registration test, `scripts/smoke.ts`, README, a user calendar-availability guide and its index, and this item. Keep shared Graph transport unchanged unless a verified mismatch requires replanning.

## Verify

Sequential gates: `bunx tsc --noEmit`, `bun run test`, `bun run test:coverage`, `bun run build`, `bun run ki:test:smoke`, and focused `ki-engineering`, `ki-repo-mcp`, `ki-work`, and `ki-work-roadmap` audits. Verify invalid direct inputs make no authentication/network call, read-tier registration exposes the tool, result schema matches structured content, and no mutation endpoint is invoked. Meet existing coverage thresholds. No live OAuth or Graph calls are included.

## Dependencies / blocks

Existing Graph/auth infrastructure and calendar scopes suffice; no local build-order dependency is identified. Owner approval of this bounded first slice and concrete response validation is still required. Account compatibility must be documented; fixture verification does not establish a particular live account's availability.

## Documentation impact

### Decision Records

No architecture decision is proposed; retain approved UTC, bounds, account, and privacy choices in this item's Discussion. Reassess if provider/auth architecture changes.

### Specifications

Define the new tool contract through shared input/result schemas and explicit verification; do not claim slot suggestions or general scheduling behavior.

### Guides

Add UTC usage, request limits, partial-error handling, and work/school-account restrictions, and update the README inventory.

### Roadmap

Retain this canonical item and its Draft/Future state pending scope approval; do not silently promise the excluded scheduling assistance.

## Outcome-authority selection

Selected under the current human instruction to finish eligible MCP roadmap outcomes autonomously. Scheduling admits the bounded read-only getSchedule slice already specified; routing admits fixture-only reconciliation of the existing four-tool delivery. Earlier pending-approval text is historical shaping, superseded by this scoped selection. MSAL migration remains outside this batch because its endpoint/cache compatibility decisions are unresolved. No live Graph/OAuth action, push or pruning is included. Final state requires independent root review.

## Review

### Delivered

Added the bounded read-only free/busy slice through `m365_calendar_availability_get`. Execution baseline is `00bc15bb84e2dc1a5bc1934cb5da4734e7d49dd7`; this item does not claim meeting-slot suggestions or calendar mutation.

### Change Summary

Strict shared schemas enforce UTC timestamps, 1–20 unique SMTP targets, a positive seven-day maximum and 5–1440 minute intervals. The handler validates direct-library input before authentication, POSTs to getSchedule with a 256 KiB response cap, and projects only ordered availability codes or explicit target errors. Missing, duplicated, unexpected and malformed schedule responses cannot fabricate free time. Graph's documented view codes are 0–3; working elsewhere is represented as 0. Registration uses READ_ONLY_REMOTE and matching output schema; public calendar exports, smoke inventory, README and the user availability guide are updated.

### Verification

Fresh local typecheck, full tests, coverage, build and modern/legacy protocol smoke pass. LCOV verifies 2,907/2,907 lines, 2,109/2,109 branches and 424/424 functions covered. Focused engineering, MCP, work, roadmap and guides audits pass. New synthetic fixtures cover input boundaries, invalid-input no-call behavior, exact UTC request, partial/missing provider results, malformed/extra/duplicate targets, privacy projection, transport/authentication failure and read-tier registration. Provider API and availability code contracts were checked against Microsoft Learn on 2026-10-05. No live Graph or OAuth flow was executed.

### Outstanding concerns

Delegated personal Microsoft accounts are unsupported by the provider and documented. Fixture verification does not establish availability or consent for any live account. Scheduling assistance beyond free/busy remains excluded from the selected first delivery. Independent root review is pending.

### Post-change review

Reviewed input-before-authentication ordering, response cardinality/slot checks, no mutation endpoint, privacy projection, direct-library export and schema/structured-result consistency. Required gates passed on the combined source; no token values, event subjects or provider error-message details are returned. Independent review is separate from this author review.

### Mini recap

MCP-M365-TOOL-005 now delivers the scoped scheduling goal and is Awaiting review. Usage, UTC conversion, provider restrictions and unavailable-state meanings live in the user calendar-availability guide. No additional learning route or live-account validation is implied.

## Done

Accepted 2026-10-05 under the user’s current all-MCP completion instruction and standing approval to accept Awaiting-review items. The root coordinator independently reviewed exact candidate `34be44f48ed04ddbb40313c89decd789e287ec2f`, the implementation/annotation/privacy boundaries and six-part review evidence. Required full gates pass; no live Graph or OAuth assurance is claimed.

## Discussion

### Readiness review

A future first slice can be read-only free/busy, but useful limits, timezone/DST behavior, target calendars and whether suggested slots are in scope must be fixed before readiness.
