---
id: MCP-M365-FND-001
area: FND
title: Use MSAL refresh
theme: foundation-tooling
horizon: now
status: done
blocks: []
blocked_by: []
baseline_ref: e7e17a8ba4f8e6b27cab03fc9c1ad3d69db2521a
created_at: 2026-07-29T00:37:05Z
updated_at: 2026-10-05T08:35:55Z
---

# MCP-M365-FND-001: Use MSAL refresh

## Goal

Microsoft's supported MSAL library owns token acquisition and refresh while existing users retain their token file, configured permissions, authentication entry points and effective endpoints without forced reauthentication.

## Context

Both `src/main/auth/index.ts` and `src/auth-server/index.ts` currently assemble OAuth exchange requests by hand and write legacy-shaped token JSON. The core accepts an explicit token endpoint; the standalone callback currently derives its effective endpoint from authority host and tenant. Current defaults use the configured XDG token location; the configured token path remains authoritative, not a hard-coded historical home-file path.

The earlier blocker inferred impossibility from MSAL not returning refresh tokens in AuthenticationResult. The supported public `system.networkClient` interface instead receives the raw token response body. A repository-owned transport can retain the rotated refresh token privately and persist the existing file only after the public acquisition operation validates successfully. This route requires real pinned-library fixtures before either writer is migrated.

## Boundary

Preserve exact existing token-file representation, configured scopes, public factory signatures, authentication-required error behavior, effective core and callback endpoints, atomic 0600 storage and single-use state/PKCE. Add only reversible token-operation locking/derived state needed for concurrent-process safety. Do not force reauthentication, silently drop custom endpoints, add canonical note/source authority, parse private MSAL cache internals, use live provider/consent flows, publish packages, push or prune. Root independent review is required before acceptance even though the outcome envelope targets Done.

## Current state

The main token factory injects tokenStorePath, client ID/secret, redirect URI, scopes, tenant and token endpoint. StoredTokens holds access_token, refresh_token, expires_in/expires_at, scope, token_type and permitted additional token response fields. Core refresh retains the prior refresh token when the provider omits a replacement and uses an in-process single-flight promise. Both writers replace the file atomically, but this is not cross-process serialization. The callback enforces exact single-use OAuth state and PKCE verifier binding; retain those guards independently of the MSAL exchange adapter.

## Steps

- [x] Pin an official Node-compatible MSAL dependency and prove its public transport bridge with synthetic responses before replacing production exchange code. Stop on feasibility failure; preserve the current source and record exact evidence.
- [x] Introduce a lazy, config-injected adapter using only public acquireTokenByRefreshToken/acquireTokenByCode and a public INetworkModule transport. Disable PII logging and unbounded retries; allow requests only to approved effective endpoints and explicitly selected metadata behavior.
- [x] Capture raw successful token JSON privately through that transport; persist existing legacy fields only after successful MSAL validation. Preserve rotated or omitted refresh-token semantics, configured scope behavior, expiry buffering and old-file rollback on failure. Never expose tokens in results/errors/logs.
- [x] Prove custom core endpoints and the existing derived callback endpoint through real-library offline fixtures with no unexpected discovery call. Do not unify their current difference inside this migration.
- [x] Serialise shared-token-file operations across processes with bounded acquisition and safe stale-owner recovery. Reload inside the lock before refresh/code exchange; retain in-process single-flight. Do not steal a live lock or discard the prior token file on a failed write.
- [x] Migrate the core refresh/code exchange and standalone callback through the same supported adapter while retaining state/PKCE and effective endpoint semantics. Keep public factories and authentication errors compatible.
- [x] Verify real pinned-library rotated/omitted refresh, existing valid/expired token files, malformed provider responses, auth failures, parallel process refresh/code exchange, atomic permissions/write failure, cleanup and token secrecy with isolated fixtures.
- [x] Update operator/developer authentication documentation; run complete gates, write the six-heading Review packet and return the exact commit for independent review.

## Files touched

Expected scope: package metadata and Bun lockfile; new MSAL transport/adapter and token-lock helper with co-located fixtures under `src/main/auth/`; `src/main/auth/index.ts` and existing auth fixtures; `src/auth-server/index.ts` plus an injectable/testable callback exchange seam; configuration only if required to thread already-supported values; authentication/configuration/developer guides; this item and its exact batch account. No provider library internals, live token files or unrelated MCP concerns.

## Verify

Before migration, test a real pinned MSAL client against a mocked INetworkModule rather than mocking the acquisition client itself. Assertions must prove the intended endpoint and grant/PKCE/scope semantics, raw refresh capture, no unexpected metadata/discovery network, successful MSAL validation and no private-cache dependency. Use child-process fixture token stores to prove serialized reload/rotation, bounded wait, live-lock refusal, safe stale recovery and failed-write rollback with 0600 storage.

After implementation run `bunx tsc --noEmit`, `bun run test`, `bun run test:coverage`, `bun run build`, `bun run ki:test:smoke`, Biome/Knip and focused engineering, MCP, work, roadmap and guides audits sequentially. Meet all existing 100% coverage thresholds. No gate can depend on live Entra credentials or real token storage. A feasibility or verification failure stops this item without fabricated completion.

## Dependencies / blocks

No local build-order dependency. The current user completion directive and root selection resolve the routine architecture choice in favor of a backward-compatible transport bridge; no cache-format migration or permission drop is admitted. All earlier cache/reauthentication questions are superseded only to that preserved-contract extent. A new incompatibility requires a stop, not an inferred answer to the pending asynchronous question.

## Documentation impact

### Decision Records

Document the supported transport bridge and retained legacy-store authority if the verified architecture has durable maintenance consequences; do not describe a private MSAL cache translation that was never implemented.

### Specifications

Keep token-file shape, effective endpoints, permission behavior, state/PKCE and authentication failures compatible. Record cross-process lock and rollback guarantees precisely against fixtures.

### Guides

Explain unchanged configured token locations and sign-in flow, bounded lock/recovery behavior and retained custom endpoint semantics. Do not instruct existing users to delete working tokens or reauthenticate.

### Roadmap

This canonical item is Now/Awaiting review under the current exact outcome envelope. Delivery stops at Awaiting review for root independent review before consolidated Done acceptance; pruning remains outside authority.

## Review

### Delivered

Delivered the approved backward-compatible MSAL acquisition boundary from immutable baseline `e7e17a8ba4f8e6b27cab03fc9c1ad3d69db2521a`. Both core refresh/code exchange and standalone callback/PKCE use pinned `@azure/msal-node` 7.0.1 public APIs. Existing populated token JSON loads unchanged without forced sign-in. This delivery commit contains the reviewable source, fixtures and evidence; its exact full commit is returned to root for independent review before acceptance. No live provider, account, token store, consent, push, publish or pruning operation was performed.

### Change Summary

- `src/main/auth/msal.ts` and its real-library fixtures add a fresh transient confidential client, supported raw-response transport capture, static authority metadata/known authorities, exact destination and configured-scope preservation, a 1 MiB response limit, absolute 15-second request cancellation, disabled internal retries/PII logging and redacted errors. Persistence receives tokens only after successful public MSAL validation.
- `src/main/auth/index.ts`, `token-lock.ts`, `callback.ts`, their co-located tests, `src/auth-server/index.ts` and isolated `scripts/fixtures/` migrate both writers, retain core six-field exchange and callback full-response shapes, preserve refresh rotation/omission and legacy refresh extension fields, reload under a shared bounded process lock, retain single-flight, and publish memory only after atomic 0600 replacement. Failure cleans owned temporary files and leaves the prior token file intact. Core explicit endpoint and callback host/tenant-derived endpoint remain deliberately distinct.
- Package metadata/Bun lock pin the official dependency; Knip declares runtime fixture entry points. `AGENTS.md`, authentication and local-development guides describe the supported bridge, retained session file, exact endpoint behavior, bounded locking and conservative recovery. Routine compatibility choices stay inside the approved preservation boundary.

### Verification

The disposable pre-migration experiment and committed fixtures use the actual pinned MSAL acquisition algorithm with synthetic transport responses. They prove code/PKCE, custom endpoints without discovery, exact configured scopes, rotation/omission, malformed responses, redacted provider/transport failures and usable expiry. Root synthetic probes identified malformed refresh-token types and overflowing expiry that MSAL itself accepts; explicit adapter validation now rejects non-string/empty present refresh tokens and non-safe absolute expiry before either writer can persist them. Real-library regressions prove prior file and memory survive these failures for refresh and code grants, while numeric-string lifetime compatibility remains covered. Independent review of candidate `0d9d54c7dd59ea3345726d506dedfd8e3f8c6d1f` then reproduced JavaScript coercion of array/boolean lifetimes; the correction requires a numeric scalar or nonblank decimal numeric string before conversion. Both grant paths reject arrays, booleans, null, objects and malformed/overflow strings with unchanged prior disk/memory, while valid string `3600` persists compatibly. The reviewed candidate remains in history and this correction is a separate commit for fresh exact-candidate review. Existing valid JSON is neither rewritten nor reauthenticated. Filesystem fixtures prove atomic 0600 replacement, failed-write/rename rollback and cleanup.

Real subprocess fixtures prove two-process refresh deduplication/reload, code-exchange/refresh serialization, live-lock refusal, terminated-owner recovery, and retention of malformed, missing, oversized, inaccessible, symlinked or otherwise unknown lock evidence. A real callback-server subprocess proves exact single-use state after success, failure and cancellation, verifier/challenge binding, derived endpoint, safe error HTML/stderr and unchanged prior file on failed exchange. No live Microsoft requests occur.

Sequential gates pass: `bunx tsc --noEmit`, `bun run test`, `bun run test:coverage`, `bun run build`, `bun run ki:test:smoke`, `bunx @biomejs/biome check .`, `bunx knip`, plus focused `ki repo audit --skill` checks for `ki-engineering`, `ki-repo-mcp`, `ki-work`, `ki-work-roadmap`, `ki-guides` and `ki-authoring`. The full suite has 42 passing files and 1203 passing tests; coverage is 100% on lines, statements, functions and branches. Smoke proves modern discovery/real tool calls, legacy fallback and the unchanged 45-tool surface. Final delivery checks re-run after the absolute request-cancellation hardening and review-record edits.

### Outstanding concerns

Live Entra issuance/consent is intentionally unobserved; only the actual pinned library algorithm against isolated synthetic responses is proven. File locks assume processes on the same local host. PID reuse or inaccessible liveness prevents recovery; an interrupted owner creation or recovery guard remains for manual inspection rather than unsafe age-based deletion. These limits and recovery instructions are documented. No failing gate remains. One pre-existing Biome non-null-assertion warning in `calendar/availability.test.ts` and seven existing Knip configuration hints remain out of scope; neither fails its gate.

### Post-change review

The migration meets the approved goal without cache-format conversion, private cache parsing, forced authentication, endpoint unification or scope reduction. The provider algorithm is genuinely MSAL-owned while the repository retains legacy persistence and compatibility. Regression risk concentrates at the supported transport seam and local lock recovery; real-library, filesystem, callback and subprocess fixtures cover both. The independently reviewed candidate required the explicit expiry-type correction above. Root independent review of the new exact correction commit remains required before consolidated batch acceptance. This packet is delivery evidence, not self-acceptance.

### Mini recap

Both OAuth writers now use public MSAL, legacy sessions survive, concurrent writers serialize/reload, and failed acquisition/persistence preserves existing disk state. Required verification and all existing coverage thresholds pass. The developer and authentication guides carry durable bridge/recovery guidance; no external authority, publication, live-provider operation or work-item deletion occurred. Hand the exact committed candidate to root/reviewer; retain this item at Awaiting review until independent review and aggregate batch closure.

## Done

Accepted under named done-target MCP-M365-BATCH-002 outcome authority and the principal’s standing acceptance instruction. Independent reviewer `review_gsuite_m365` approved corrected exact candidate `eee6851a49cadb57341c3e57f76b73f13af6a510`. Compiled-library probes on actual Node 22.16.0 verified both grant paths, malformed-response rejection with unchanged old file/memory, legacy valid-file loading without acquisition, refresh rotation/omission, exact scopes/endpoints and callback PKCE. Independent real child processes proved refresh coalescing, code/refresh rotation preservation, live-lock refusal and failed-rename rollback/privacy/cleanup. The reviewer reran 89 focused auth tests including single-use callback state and provider privacy. Full author gates and the complete packet satisfy all Steps. No live Entra issuance or consent is claimed; documented conservative local-lock recovery limits remain.

## Discussion

### Public transport evidence

[Microsoft's configuration contract](https://learn.microsoft.com/en-us/entra/msal/javascript/node/configuration) documents a custom networkClient, authority metadata and cache hooks. The public [INetworkModule source](https://github.com/AzureAD/microsoft-authentication-library-for-js/blob/dev/lib/msal-common/src/network/INetworkModule.ts) returns [NetworkResponse with its typed body](https://github.com/AzureAD/microsoft-authentication-library-for-js/blob/dev/lib/msal-common/src/network/NetworkResponse.ts). [RefreshTokenRequest](https://github.com/AzureAD/microsoft-authentication-library-for-js/blob/dev/lib/msal-node/src/request/RefreshTokenRequest.ts) accepts a caller-supplied refresh token for public migration/acquisition. These supported seams establish a candidate compatibility route, not proof that an untested pinned version meets every invariant.

### Cache compatibility

The [MSAL cache guidance](https://learn.microsoft.com/en-us/entra/msal/javascript/node/caching) correctly says AuthenticationResult omits refresh tokens. That does not prohibit a supported repository-owned transport from privately preserving token response fields needed by the existing file contract. Retain the legacy store as authority and avoid deserializing undocumented MSAL internals. No format conversion or forced consent is selected.

### Endpoint and ownership guarantees

Core endpoint override and standalone derived authority endpoint are distinct current behaviors. Preserve both rather than hiding their discrepancy inside library adoption. Token serialization stays repository-owned; MSAL validates and acquires. Locking must make concurrency safe without inventing permission to delete unknown live-process state.
