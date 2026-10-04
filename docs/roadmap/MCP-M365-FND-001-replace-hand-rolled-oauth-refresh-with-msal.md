---
id: MCP-M365-FND-001
area: FND
title: Use MSAL refresh
theme: foundation-tooling
horizon: soon
status: draft
blocks: []
blocked_by: []
baseline_ref: null
created_at: 2026-07-29T00:37:05Z
updated_at: 2026-10-04T10:57:33Z
---

## Goal

Achieve the stated outcome: Replace hand-rolled OAuth refresh with MSAL.

## Context

Replace the custom OAuth refresh implementation in `auth/index.ts` with `@azure/msal-node`, preserving the existing token-file shape and `ensureAuthenticated` call sites through a deliberate migration.

## Boundary

Keep the work limited to the stated surface.

## Shaping

The intended approach is to keep the module's public surface fixed and swap only what is underneath it. `createTokenStorage(cfg)` and `makeEnsureAuthenticated(storage)` in `src/main/auth/index.ts` are the only auth entry points the rest of the server uses — `src/mcp-server/index.ts` calls both once at boot and threads the result into `GraphContext.ensureAuthenticated` — so if those two signatures and the `Error('Authentication required')` contract hold, no `main/` handler and no tool registration changes.

There are two hand-rolled OAuth code paths, not one, and both are in scope. `TokenStorage.refreshAccessToken` and `TokenStorage.exchangeCodeForTokens` in `src/main/auth/index.ts` build form bodies with `node:querystring` and post them with `node:https`; `src/auth-server/index.ts` has its own separate PKCE authorization-code exchange that builds the authorize URL, computes an S256 challenge, and writes the token response to the same token-store path with its own atomic temp-file-plus-rename. Migrating only the first would leave the consent flow hand-rolled and the two writing the same file in different shapes.

`@azure/msal-node` is not in `package.json` today, so this is genuinely unstarted work and the package would be the first runtime dependency beyond `@modelcontextprotocol/sdk` and `zod`. It has to work under Node 22 from built `dist/`, which is how Claude Desktop launches the server.

`M365_DEFAULT_SCOPES` in `src/config/index.ts` is documented as the single source of truth for both consent-time and refresh-time scopes, precisely because drift between them causes silent 403s. MSAL applies its own handling to reserved scopes such as `offline_access`, so the migration needs an explicit answer for how that list is passed through without the two flows diverging again.

Decisions still needed before this is promotable:

- Whether to preserve the existing `~/.mcp-m365-tokens.json` shape by writing a custom MSAL cache-persistence plugin, or to adopt MSAL's own cache format and ship a migration for users who already have a token file.
- Whether the safety properties currently owned by this module stay ours or are ceded to MSAL: the `0600` atomic temp-file write, and the single-flight `_refreshPromise` that stops concurrent handlers from racing the same refresh.
- Whether the `MCP_M365_TENANT_ID`, `MCP_M365_AUTHORITY_HOST`, and `MCP_M365_TOKEN_ENDPOINT` overrides in `loadConfig()` survive as MSAL authority configuration, since MSAL derives its endpoints from an authority rather than taking a token endpoint directly.
- How `src/main/auth/index.test.ts` and `src/main/auth/handlers.test.ts` reach the repository's 100% coverage thresholds once the network path sits inside a third-party library rather than in `node:https` calls this repository can stub.

Promotion to `next` is warranted once the cache-persistence and token-file-compatibility decisions are made and the coverage approach is agreed, because those three determine whether this is a contained swap or a migration with user-visible consequences.

## Planning boundary and review outcome

The MSAL migration remains a compatibility-sensitive refactor rather than a dependency replacement ready for implementation. Before selection/readiness, produce an explicit design for both the MCP refresh/exchange path and the standalone callback exchange. Identify the current token-file consumers, choose preserved-file versus migrated-cache behavior, and specify backup, atomic 0600 persistence, rollback, and recovery when migration fails. Preserve public auth factory signatures and authentication-required errors unless a separate compatibility change is approved.

Choose how authority/tenant/token-endpoint overrides map to MSAL or are rejected with a documented migration path; do not silently ignore a configured endpoint. Decide cross-process token ownership and refresh serialization, rather than treating an in-process single-flight promise as a cross-process lock. Define an injectable MSAL test seam and offline fixture coverage for cache load/save, refresh omission, concurrent calls, code exchange, migration/rollback, errors, and token secrecy. Verify built Node 22 runtime compatibility and the existing full coverage gates.

Expected later scope includes `src/main/auth/`, `src/auth-server/`, configuration and tests, package metadata/lockfile, and authentication/configuration/operator migration guides. A reversible migration design is required before adopting a new runtime dependency. Current Soon/Draft state remains honest; none of the cache, override, rollback, or concurrency decisions is approved by this analysis. Reachable read-tier recovery guidance is separately owned by MCP-M365-FND-006 and must not be duplicated into the MSAL migration.

## Discussion

### Why replace something that works

The current implementation is functional and tested, so the argument is not correctness today but ownership: token refresh, expiry buffering, and PKCE are security-sensitive protocol details that Microsoft's own library tracks against changes to the identity platform. The counter-argument is that the hand-rolled code is small, dependency-free, and does exactly what this server needs, and that adopting MSAL trades that for a dependency whose cache format the server would then be coupled to.

### Compatibility is the deciding constraint

An existing user has a populated token file and a working consent. Any approach that silently invalidates it forces re-authentication through `m365_auth_start`, which is a user-visible regression rather than an internal refactor. That is what makes the cache-persistence decision the gate on this item rather than a detail of its implementation.

### Readiness review

Readiness requires a chosen token-cache migration and rollback path preserving atomic 0600 writes and concurrent refresh handling across both processes. Existing OAuth service configuration overrides need explicit disposition; library adoption alone is not a complete plan.
