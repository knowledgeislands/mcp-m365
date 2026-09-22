---
id: MCP-M365-FND-002
area: FND
title: Migrate MCP protocol profile
theme: foundation-tooling
horizon: now
status: ready
blocks: []
blocked_by: []
baseline_ref: null
created_at: 2026-09-02T01:12:46Z
updated_at: 2026-09-22T06:56:00Z
---

## Goal

Move mcp-m365 to the supported MCP 2026-07-28 server profile without breaking its existing tool surface or legacy clients.

## Context

The Harness KI-HARNESS-GOV-006 rollout now derives protocol applicability from the runtime dependency. This repository still declares @modelcontextprotocol/sdk major 1 and remains conformant to the legacy 2025-11-25 profile. The accepted mcp-git-audit pilot proves the modern package family, per-connection stdio factory, SDK-owned discovery, complete result envelopes, smoke boundary, and deliberate compatibility fallback.

## Boundary

Do not change the public tool contract, remove legacy compatibility without evidence, or treat the Harness rollout as receiver acceptance. This record captures receiver-owned migration work only; prioritisation, implementation, verification, acceptance, release, and publication remain in this repository.

## Shaping

Adopt the accepted pilot as the first comparison baseline: move to the v2 server package family, replace the legacy stdio transport with a per-connection serveStdio factory, add resultType: "complete" to synchronous result helpers, retain deliberate legacy fallback, and prove SDK-owned discovery through the repository smoke boundary.

Promote to Next when the exact dependency delta, entry-point change, compatibility boundary, and receiver-specific smoke assertions are reviewed against this repository's current source.

## Current state

The repository declares `@modelcontextprotocol/sdk` `^1.30.0` as its only MCP dependency, so `ki repo audit --skill ki-repo-mcp` classifies it as a conformant legacy 2025-11-25 server and the modern-only PROTO-1 checks do not apply. The legacy surface is confined to nine source sites: `src/mcp-server/index.ts` imports both `McpServer` and `StdioServerTransport`, `src/utils/access-level.ts` imports `McpServer` and `ToolAnnotations`, and each of the seven `src/tools/<group>/index.ts` files imports the `McpServer` type. `scripts/smoke.ts` additionally imports the legacy `Client` and `StdioClientTransport`.

The entry point constructs one `McpServer` at module scope and awaits `server.connect(new StdioServerTransport())` inside `main()`. There is no per-connection factory, so a single instance is bound to the process rather than to the connection, and the era decision is made by the legacy transport rather than by the SDK.

Tool registration already matches the v2 primary overload: every `registerTool` call passes a full `z.object({...}).strict()` as `inputSchema`, which the v2 `StandardSchemaWithJSON` signature accepts directly (the raw-shape form is the deprecated overload). `makeAccessGatedRegister` proxies `server.registerTool` structurally and needs only its two type imports repointed.

Result envelopes are split. `src/utils/results.ts` exports `errorResult` and `errorText`; the thirty handler modules under `src/main/` build their success envelopes inline as `{ content: [{ type: 'text', text }] }`, three of them adding `structuredContent`, and six adding `isError` inline. `zod` is pinned to `4.4.3` and `.ki.toml` carries the dependency hold `zod — 4.5.4 is incompatible with @modelcontextprotocol/sdk 1.30.0 schema types`, which exists only because of the legacy SDK.

`scripts/smoke.ts` asserts the tool-surface list and the presence of an `inputSchema` on each tool. It performs no `tools/call`, makes no protocol-era assertion, and has no legacy-client leg, so it cannot prove SDK-owned discovery or a valid result envelope.

`ki repo audit --concise --progress never` currently passes at 15 skills, and that must remain true after the migration.

## Steps

- [ ] Replace the dependency selection in `package.json`: drop `@modelcontextprotocol/sdk`, add `@modelcontextprotocol/server` `2.0.0` to `dependencies` and `@modelcontextprotocol/client` `2.0.0` to `devDependencies`, mirroring the accepted pilot. Mixed families are a PROTO-1 violation, so the legacy package must leave in the same change.
- [ ] Repoint the nine legacy source imports: `McpServer` and `ToolAnnotations` now both come from `@modelcontextprotocol/server`. No `@modelcontextprotocol/sdk` specifier and no `StdioServerTransport` identifier may survive anywhere under `src/`.
- [ ] Convert `src/mcp-server/index.ts` to a per-connection factory. Keep config loading, token storage, the derived `GraphContext`/`TriageContext`, and the boot logging at module scope; move `new McpServer(...)`, the access-gate assignment, and the seven `register*Tools` calls into a `createServer(): McpServer` factory handed to `serveStdio(createServer, { legacy: 'serve', onerror })`. Retain the existing `SIGTERM` behaviour and close the returned handle on `SIGINT`.
- [ ] Carry `resultType: 'complete'` on the synchronous result helpers in `src/utils/results.ts` and extend `src/utils/results.test.ts` to assert it on both, keeping the 100% coverage thresholds satisfied.
- [ ] Rewrite the `scripts/smoke.ts` boundary against `@modelcontextprotocol/client`: assert the modern protocol era, the negotiated `2026-07-28` revision, and a `server/discover` result whose `resultType` is `complete` and whose advertised server identity matches; keep the existing tool-surface and `inputSchema` assertions unchanged; add a `m365_about` round trip and a malformed-argument rejection; then open a second, deliberately legacy client and assert the fallback still serves the identical tool surface.
- [ ] Reassess the `zod` dependency hold in `.ki.toml` now that its stated cause (the legacy SDK's schema types) is gone: bump `zod` and remove the hold only if the toolchain agrees, otherwise restate the hold against its real cause.
- [ ] Record the migration in `CHANGELOG.md` under an Unreleased heading, naming the protocol-profile move and the retained legacy fallback.
- [ ] Run the declared gates and `ki repo audit --concise --progress never`, and confirm PROTO-1 now reports the modern profile while the audit still passes at 15 skills.

## Files touched

- `package.json`, `bun.lock` — dependency family swap.
- `src/mcp-server/index.ts` — per-connection factory and `serveStdio` boundary.
- `src/utils/access-level.ts`, `src/tools/{auth,calendar,email,folder,onedrive,rules,triage}/index.ts` — type-import repointing only.
- `src/utils/results.ts`, `src/utils/results.test.ts` — complete result discriminator and its assertions.
- `scripts/smoke.ts` — v2 client, discovery, result-envelope, and legacy-fallback assertions.
- `.ki.toml` — dependency-hold reassessment.
- `CHANGELOG.md` — release note.
- `docs/roadmap/MCP-M365-FND-002-migrate-mcp-protocol-profile.md` — this record.

No file under `src/main/` is expected to change: the v2 encode contract stamps `resultType: 'complete'` on any handler result that omits it, so the thirty handler modules need no edit and the public tool contract stays byte-identical.

## Verify

- `bun run build` — `tsc -p tsconfig.build.json` succeeds, proving the v2 types accept the existing `z.object(...)` registrations.
- `bunx tsc -p tsconfig.json --noEmit` — whole-tree typecheck including tests and scripts.
- `bunx @biomejs/biome check .` — lint and format gate that `lint-staged` enforces on commit.
- `bun run test` then `bun run test:coverage` — all suites pass and every coverage threshold stays at 100%.
- `bun run ki:test:smoke` — the rewritten smoke boundary passes, which is the only assertion that the live wire is modern: era, negotiated revision, discovery envelope, a real `tools/call`, argument rejection, and the legacy fallback.
- `ki repo audit --concise --progress never` — still PASS at 15 skills, with `ki repo audit --skill ki-repo-mcp` reporting `@modelcontextprotocol/server 2.0.0 selects the modern 2026-07-28 profile` and no retained legacy boundary.

## Dependencies / blocks

Nothing blocks this item: the modern package family is published and the pilot is accepted, so the build order is satisfied. `blocked_by` stays empty.

MCP-M365-FND-001 (MSAL adoption) touches `src/main/auth/` and this item does not, so the two are independent; sequencing is preference, not build order. MCP-M365-FND-005 is concurrently shaping `docs/roadmap/` only and shares no source file with this item.

The Harness KI-HARNESS-GOV-006 rollout is the origin of the applicability rule but is not a blocker and is not receiver acceptance. Acceptance, release, and publication of this repository remain local and out of scope here.

## Documentation impact

### Decision Records

No Decision Record is needed. The choice of protocol profile is already governed by `ki-repo-mcp` §12 and was decided by the accepted pilot; this item applies that decision rather than making a new one. If the `zod` hold has to be restated for a different cause, that is a `.ki.toml` fact, not durable rationale.

### Specifications

No behaviour-level contract changes. Tool names, descriptions, input schemas, annotations, and response text are unchanged by design, and the smoke boundary asserts the surface is identical across both protocol eras.

### Guides

No human guidance changes. The install, configure, and run instructions in `README.md` are protocol-agnostic, and MCP-M365-FND-005 owns the audience-centric guide work separately.

### Roadmap

No follow-on roadmap record is needed. MCP-M365-FND-003 (conformance-audit review) already covers any residual audit finding, and the retained legacy fallback is a deliberate standing position rather than deferred work; a future record would be warranted only when the fleet is ready to set `legacy: 'reject'`.

## Discussion

### Source evidence

The portable profile and rubric live in ki-repo-mcp; the accepted mcp-git-audit migration is implementation evidence, not a patch to copy mechanically. Receiver-specific authentication, configuration, generated client, and tool-envelope differences remain local design inputs.

### Result-envelope breadth

The pilot funnels every result through `jsonResult`/`errorResult`, so stamping the discriminator there covered its whole surface. This repository does not: fifty-two success envelopes are built inline across thirty `src/main/` modules. Mechanically rewriting all of them was considered and rejected on evidence. The v2 encode contract's `stampResultType` step adds `resultType: 'complete'` to any result that omits it and only errors on a conflicting value, and `ki-repo-mcp` §12 scopes the requirement to the synchronous helpers rather than to every call site. Changing fifty-two handlers would therefore buy no wire-level difference while enlarging the diff across the exact modules the Boundary protects. The helpers carry the discriminator; the handlers are left alone.

### Compatibility fallback

`legacy: 'serve'` is a deliberate retention, not an oversight. The Boundary forbids removing legacy compatibility without evidence, and the evidence needed is fleet-wide client readiness, which this repository cannot observe. The smoke boundary therefore asserts the fallback positively — a second client that opens in the legacy era must still see the identical tool surface — so the compatibility claim is tested rather than assumed.

### Acceptance boundary

The modern profile is not claimed until this repository's package, result helpers, stdio entry point, focused tests, live smoke, and ki-repo-mcp audit agree. A passing legacy audit before migration remains expected.
