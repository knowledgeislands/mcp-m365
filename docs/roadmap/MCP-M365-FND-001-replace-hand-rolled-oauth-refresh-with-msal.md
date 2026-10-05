---
id: MCP-M365-FND-001
area: FND
title: Use MSAL refresh
theme: foundation-tooling
horizon: now
status: ready
blocks: []
blocked_by: []
baseline_ref: null
created_at: 2026-07-29T00:37:05Z
updated_at: 2026-10-05T08:02:28Z
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

- [ ] Pin an official Node-compatible MSAL dependency and prove its public transport bridge with synthetic responses before replacing production exchange code. Stop on feasibility failure; preserve the current source and record exact evidence.
- [ ] Introduce a lazy, config-injected adapter using only public acquireTokenByRefreshToken/acquireTokenByCode and a public INetworkModule transport. Disable PII logging and unbounded retries; allow requests only to approved effective endpoints and explicitly selected metadata behavior.
- [ ] Capture raw successful token JSON privately through that transport; persist existing legacy fields only after successful MSAL validation. Preserve rotated or omitted refresh-token semantics, configured scope behavior, expiry buffering and old-file rollback on failure. Never expose tokens in results/errors/logs.
- [ ] Prove custom core endpoints and the existing derived callback endpoint through real-library offline fixtures with no unexpected discovery call. Do not unify their current difference inside this migration.
- [ ] Serialise shared-token-file operations across processes with bounded acquisition and safe stale-owner recovery. Reload inside the lock before refresh/code exchange; retain in-process single-flight. Do not steal a live lock or discard the prior token file on a failed write.
- [ ] Migrate the core refresh/code exchange and standalone callback through the same supported adapter while retaining state/PKCE and effective endpoint semantics. Keep public factories and authentication errors compatible.
- [ ] Verify real pinned-library rotated/omitted refresh, existing valid/expired token files, malformed provider responses, auth failures, parallel process refresh/code exchange, atomic permissions/write failure, cleanup and token secrecy with isolated fixtures.
- [ ] Update operator/developer authentication documentation; run complete gates, write the six-heading Review packet and return the exact commit for independent review.

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

This canonical item is Now/Ready under the current exact outcome envelope. Delivery stops at Awaiting review for root independent review before consolidated Done acceptance; pruning remains outside authority.

## Discussion

### Public transport evidence

[Microsoft's configuration contract](https://learn.microsoft.com/en-us/entra/msal/javascript/node/configuration) documents a custom networkClient, authority metadata and cache hooks. The public [INetworkModule source](https://github.com/AzureAD/microsoft-authentication-library-for-js/blob/dev/lib/msal-common/src/network/INetworkModule.ts) returns [NetworkResponse with its typed body](https://github.com/AzureAD/microsoft-authentication-library-for-js/blob/dev/lib/msal-common/src/network/NetworkResponse.ts). [RefreshTokenRequest](https://github.com/AzureAD/microsoft-authentication-library-for-js/blob/dev/lib/msal-node/src/request/RefreshTokenRequest.ts) accepts a caller-supplied refresh token for public migration/acquisition. These supported seams establish a candidate compatibility route, not proof that an untested pinned version meets every invariant.

### Cache compatibility

The [MSAL cache guidance](https://learn.microsoft.com/en-us/entra/msal/javascript/node/caching) correctly says AuthenticationResult omits refresh tokens. That does not prohibit a supported repository-owned transport from privately preserving token response fields needed by the existing file contract. Retain the legacy store as authority and avoid deserializing undocumented MSAL internals. No format conversion or forced consent is selected.

### Endpoint and ownership guarantees

Core endpoint override and standalone derived authority endpoint are distinct current behaviors. Preserve both rather than hiding their discrepancy inside library adoption. Token serialization stays repository-owned; MSAL validates and acquires. Locking must make concurrency safe without inventing permission to delete unknown live-process state.
