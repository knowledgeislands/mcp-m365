---
id: MCP-M365-FND-006
area: FND
title: Expose reachable auth recovery
theme: foundation-tooling
horizon: next
status: awaiting-review
blocks: []
blocked_by: []
baseline_ref: b36d28867903a7b4ff491c1c2e0ed761adfee9ce
transferred_from: KI-ARCADIA-ECO-004
created_at: 2026-10-04T10:40:30Z
updated_at: 2026-10-04T12:14:24Z
---

## Goal

A caller whose Microsoft 365 authentication fails can follow the recovery instructions available at its configured access level, including the default read tier.

## Context

[Arcadia's reconciled MCP findings](../../../ki-arcadia-principal/Streams/Roadmap/KI-ARCADIA-ECO-004-route-deferred-mcp-findings.md) reproduced a synthetic 401 whose recovery hint names `m365_auth_start`, although that tool is absent at default read access. Fresh owner-source review confirms that `src/utils/results.ts` describes the authentication hint, `src/tools/auth/index.ts` annotates `m365_auth_start` as `WRITE_REMOTE`, and the authentication guide already explains the browser route and the write-tier requirement. The tool error therefore directs a read-tier caller to an unavailable tool without supplying that reachable alternative.

The existing MSAL migration item, MCP-M365-FND-001, owns token/cache implementation and compatibility, not recovery guidance at the tool error boundary. No retained roadmap or trade record owns this focused outcome.

## Boundary

Capture recovery guidance and its access-tier reachability only. Preserve the truthful write annotation for token-persisting authentication, the default read tier, token redaction, and existing browser consent boundaries. Do not migrate token storage, widen permissions automatically, perform live OAuth or Graph operations, or include package-badge maintenance.

## Current state

`src/utils/errors.ts` appends "Run the `m365_auth_start` tool to refresh the OAuth token." to every 401-like Graph failure, and 31 handlers under `src/main/` return the literal "Authentication required. Please use the 'm365_auth_start' tool first." when no usable token exists. `m365_auth_start` is annotated `WRITE_REMOTE`, so at the default `read` level neither message offers a remedy the caller can reach. The authentication and troubleshooting guides already lead with the browser route through the callback server's `/auth` page.

## Steps

- [x] Rewrite `AUTH_HINT` so it leads with the browser route (start the callback server with `bun run ki:server:auth:dev` and open its `/auth` page), then states that `m365_auth_start` runs the same flow only at `MCP_M365_ACCESS_LEVEL=write` or above and that changing the level needs a client restart. Name no fixed host or port and no token path; the callback address stays the operator's configured one, as the guides explain.
- [x] Add one exported `AUTH_REQUIRED_MESSAGE` built from the same hint, and replace the 31 duplicated "Authentication required" literals with it, keeping each handler's control flow unchanged.
- [x] Add tests: hint and message content; the read-level access gate omits `m365_auth_start` while `m365_auth_status` remains, and the write level registers it with unchanged `WRITE_REMOTE` annotations; update the handler tests that pin the old literal. No consent, token store or Graph call is involved.
- [x] Update the troubleshooting guide's entry for the old message text.

## Files touched

`src/utils/errors.ts` and its test; the 31 handler modules under `src/main/` that return the literal, and the handler tests that pin it; an access-gate registration test; `docs/guides/user/troubleshooting.md`.

## Verify

Focused tests pass, then `bun run test`, `bun run test:coverage` (thresholds hold), `bunx tsc --noEmit`, `bun run build`, `bunx biome check .`, `bunx knip`, `bun run ki:test:smoke` and `ki repo audit --repo .` with no FAIL. `grep` finds no remaining "Please use the 'm365_auth_start' tool first" in `src`. No live account, token store, browser consent or provider call.

## Dependencies / blocks

None. MCP-M365-FND-001 owns token-cache migration and is unaffected.

## Documentation impact

### Decision Records

None.

### Specifications

None.

### Guides

`docs/guides/user/troubleshooting.md` quotes the old message; update the quoted text. The authentication guide already describes both routes.

### Roadmap

This record only.

## Review

### Delivered

Every authentication failure now carries recovery a read-level caller can follow. `AUTH_HINT` leads with the browser route (start the callback server with `bun run ki:server:auth:dev` and open its `/auth` page), then says `m365_auth_start` runs the same flow only at `MCP_M365_ACCESS_LEVEL=write` or above and that changing the level needs a client restart. The 31 duplicated "Authentication required. Please use the 'm365_auth_start' tool first." literals are replaced by one `AUTH_REQUIRED_MESSAGE` built from the same hint. Annotations, the default read level, token handling and consent are unchanged.

### Change Summary

- `src/utils/errors.ts`: exported `AUTH_HINT` and new `AUTH_REQUIRED_MESSAGE`.
- 31 handler modules under `src/main/`: the literal replaced with `AUTH_REQUIRED_MESSAGE`; control flow untouched.
- `src/utils/errors.test.ts`: hint ordering and content, no host, URL, token path or secret; message composition.
- `src/tools/auth/index.test.ts` (new): through `makeAccessGatedRegister`, `m365_auth_start` is absent at `read` while `m365_auth_status` remains, and present at `write` with `WRITE_REMOTE`; no handler runs.
- `src/main/calendar/create.test.ts`, `src/main/email/list.test.ts`, `src/main/email/search.test.ts`: assertions follow the new message.
- `docs/guides/user/troubleshooting.md`, `docs/guides/user/authentication.md`, `AGENTS.md` (security invariant 8): quoted message and hint contract updated.

### Verification

- `bun run test:coverage`: 1139 tests pass; statements, branches, functions and lines 100%.
- `bunx tsc --noEmit`, `bun run build`, `bun run ki:test:smoke` (44 tools, valid envelope): pass.
- `bunx biome check .`: clean apart from one pre-existing info; `bunx knip`: only pre-existing configuration hints.
- `grep` finds no remaining "Please use the 'm365_auth_start' tool first" in `src`.
- `ki repo audit --repo .`: no FAIL.
- No account, token store, browser consent or Graph call was used.

### Outstanding concerns

- The hint is static: it does not print the configured callback address, by design, so an operator with a non-default `MCP_M365_REDIRECT_URI` must know their own callback host; the guides cover this.
- `bun run ki:server:auth:dev` assumes a source checkout; installed users run the compiled auth server as the installation guide describes.
- `AGENTS.md` and `docs/guides/user/authentication.md` were outside the planned Files touched but quoted the superseded text.
- A release is needed for installed users to receive the new messages.

### Post-change review

Centralising the message removes 31 copies that could drift independently, and the registration test runs the real access-gate proxy over the real auth tool definitions, so an annotation change on `m365_auth_start` would fail it. The 401 path and the no-token path now give identical remedies.

### Mini recap

A read-level caller whose Microsoft 365 sign-in has lapsed is now told the browser route that works at its level, with `m365_auth_start` correctly qualified, from one shared message.

## Discussion

### Reachable recovery

A later plan should make authentication failures explain the browser sign-in route with the callback server running, and explain that the authentication tool requires write access and a server restart when changing the tier. Use configured callback information rather than inventing a universal deployment address. Decide whether the error helper receives the needed configuration or points to a stable operator guide; preserve thin tool registration and configuration injection.

### Verification boundary

Use synthetic authentication failures and access-gated registration fixtures to prove that the read tier omits `m365_auth_start` yet exposes actionable recovery guidance. Verify write-tier tool recovery remains accurate and no token values or client secrets appear. No live account, token store, browser consent, or provider call is required.

### Intake authority

This is unadopted Triage from Arcadia's verified routing evidence. It grants no priority, Ready transition, implementation, acceptance, or publication authority. The receiving repository retains those decisions.

### Adoption

Adopted from Triage into `next` and shaped to Ready on 2026-10-04 under the owner's delegated estate-push authority. Decision: the error helper stays configuration-free and points to the callback server's `/auth` page by path, not address, because the handlers that produce these errors do not carry the auth configuration and the guides already document the configured callback. The 31 "Authentication required" literals are in scope because they are the same unreachable remedy at the same tool-error boundary.
