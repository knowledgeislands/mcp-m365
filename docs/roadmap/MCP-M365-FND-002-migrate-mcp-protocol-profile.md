---
id: MCP-M365-FND-002
area: FND
title: Migrate MCP protocol profile
theme: foundation-tooling
horizon: now
status: done
blocks: []
blocked_by: []
baseline_ref: 97a41fa3e565d234da8cf0be27b09781becc5bff
created_at: 2026-09-02T01:12:46Z
updated_at: 2026-09-26T18:10:52Z
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

- [x] Replace the dependency selection in `package.json`: drop `@modelcontextprotocol/sdk`, add `@modelcontextprotocol/server` `2.0.0` to `dependencies` and `@modelcontextprotocol/client` `2.0.0` to `devDependencies`, mirroring the accepted pilot. Mixed families are a PROTO-1 violation, so the legacy package must leave in the same change.
- [x] Repoint the nine legacy source imports: `McpServer` and `ToolAnnotations` now both come from `@modelcontextprotocol/server`. No `@modelcontextprotocol/sdk` specifier and no `StdioServerTransport` identifier may survive anywhere under `src/`.
- [x] Convert `src/mcp-server/index.ts` to a per-connection factory. Keep config loading, token storage, the derived `GraphContext`/`TriageContext`, and the boot logging at module scope; move `new McpServer(...)`, the access-gate assignment, and the seven `register*Tools` calls into a `createServer(): McpServer` factory handed to `serveStdio(createServer, { legacy: 'serve', onerror })`. Retain the existing `SIGTERM` behaviour and close the returned handle on `SIGINT`.
- [x] Carry `resultType: 'complete'` on the synchronous result helpers in `src/utils/results.ts` and extend `src/utils/results.test.ts` to assert it on both, keeping the 100% coverage thresholds satisfied.
- [x] Rewrite the `scripts/smoke.ts` boundary against `@modelcontextprotocol/client`: assert the modern protocol era, the negotiated `2026-07-28` revision, and a `server/discover` result whose `resultType` is `complete` and whose advertised server identity matches; keep the existing tool-surface and `inputSchema` assertions unchanged; add a `m365_about` round trip and a malformed-argument rejection; then open a second, deliberately legacy client and assert the fallback still serves the identical tool surface.
- [x] Reassess the `zod` dependency hold in `.ki.toml` now that its stated cause (the legacy SDK's schema types) is gone: bump `zod` and remove the hold only if the toolchain agrees, otherwise restate the hold against its real cause.
- [x] Record the migration in `CHANGELOG.md` under an Unreleased heading, naming the protocol-profile move and the retained legacy fallback.
- [x] Run the declared gates and `ki repo audit --concise --progress never`, and confirm PROTO-1 now reports the modern profile while the audit still passes at 15 skills.

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

## Review

### Delivered

The approved boundary held exactly. The public tool contract is unchanged — the same 36 tools, identical names, descriptions, input schemas, annotations, and response text — and the smoke boundary proves that by asserting the surface twice, once over the modern era and once over a deliberately legacy connection. Legacy compatibility was retained, not removed: `legacy: 'serve'` stays, and the fallback is now positively tested rather than assumed. Nothing here treats the Harness rollout as acceptance; acceptance, release, and publication remain outside this record.

Immutable baseline: `97a41fa3e565d234da8cf0be27b09781becc5bff`.

Resulting evidence: `ki repo audit --concise --progress never` reports PASS at 15 skills, and the PROTO-1 inputs now read `@modelcontextprotocol/server 2.0.0` with zero `@modelcontextprotocol/sdk` or `StdioServerTransport` markers under `src/`, one `serveStdio(` call site, and three `resultType: 'complete'` occurrences against one counted helper definition in `src/utils/results.ts`.

### Change Summary

- `package.json`, `bun.lock` — removed `@modelcontextprotocol/sdk`; added `@modelcontextprotocol/server` `2.0.0` to `dependencies` and `@modelcontextprotocol/client` `2.0.0` to `devDependencies`. The two never coexisted in a committed state, so the mixed-family violation was never entered.
- `src/mcp-server/index.ts` — the module-scope `McpServer` and `await server.connect(new StdioServerTransport())` are replaced by a `createServer(): McpServer` factory handed to `serveStdio(createServer, { legacy: 'serve', onerror })`. Config, token storage, and the derived `GraphContext`/`TriageContext` stay at module scope; the server instance, access gate, and seven `register*Tools` calls moved inside the factory. `SIGTERM` behaviour is unchanged and `SIGINT` now closes the handle.
- `src/utils/access-level.ts` and the seven `src/tools/<group>/index.ts` files — type imports repointed to `@modelcontextprotocol/server`. `McpServer` and `ToolAnnotations` collapse into one import in the access gate. No logic changed; the existing `z.object(...).strict()` registrations type-check unmodified against the v2 primary overload.
- `src/utils/results.ts`, `src/utils/results.test.ts` — `errorResult` and `errorText` now carry `resultType: 'complete'`, asserted by full-envelope `toEqual` rather than field spot-checks.
- `scripts/smoke.ts` — migrated to `@modelcontextprotocol/client`, and extended with the era, negotiated-revision, and discovery-envelope assertions, a `m365_about` round trip, a strict-schema rejection, and the legacy-fallback leg. The transport construction was extracted to `createTransport()` so both clients open the same server identically.
- `.ki.toml`, `package.json` — the `zod` dependency hold named the legacy SDK's schema types as its cause, so with the SDK gone it was removed and `zod` moved from the pinned `4.4.3` to `4.6.5`, matching the pilot.
- `CHANGELOG.md` — an Unreleased entry naming the profile move, the explicit discriminator, the `zod` unpinning, and the unchanged tool surface.

Two deviations from the planned file scope, both accuracy repairs rather than scope growth:

- `CLAUDE.md` was not in `Files touched`, but two of its statements became false on delivery: the entry-point description said only that the file threads config into tool registration, with no factory or stdio boundary, and the smoke-test description named only the tool-surface assertion. Both were corrected in place. This is agent instruction, not the human guidance the Documentation impact section assessed, so that assessment stands.
- No file under `src/main/` changed, as predicted.

### Verification

| Gate | Command | Outcome |
| --- | --- | --- |
| Build | `bun run build` | PASS — `tsc -p tsconfig.build.json`, no diagnostics |
| Typecheck | `bunx tsc -p tsconfig.json --noEmit` | PASS — no diagnostics across src, tests, and scripts |
| Lint | `bunx @biomejs/biome check .` | PASS — `Checked 115 files. No fixes applied. Found 1 info.` † |
| Tests | `bun run test` | PASS — `Test Files 33 passed (33)`, `Tests 1043 passed (1043)` |
| Coverage | `bun run test:coverage` | PASS — statements 2974/2974, branches 1921/1921, functions 398/398, lines 2715/2715, all 100% |
| Smoke | `bun run ki:test:smoke` | PASS — `✓ smoke passed: modern discovery, legacy fallback, 36 tools, valid result envelope` |
| Unused code | `bunx knip` | PASS — configuration hints only, all pre-existing |
| Markdown | `bunx rumdl check` | PASS — no issues |
| Repository | `ki repo audit --concise --progress never` | PASS — `KI REPO AUDIT on mcp-m365 PASS · 15 skills` |

† The single `info` is the pre-existing `biome.json` schema pin at `2.5.12` against CLI `2.5.14`. It is present on the baseline commit, unrelated to this item, and left alone.

### Outstanding concerns

None blocking.

Two observations for the record. First, one test failed once, immediately after `bun add zod@4.6.5` replaced `node_modules/zod` mid-session; it did not reproduce across five subsequent full runs, including two clean coverage runs, and the most likely cause is a stale Vitest transform of the swapped dependency rather than a defect. It is recorded because it happened, not because it is suspected to be real.

Second, `legacy: 'serve'` remains a standing position rather than a resolved question. Retiring it needs fleet-wide client readiness this repository cannot observe, so no follow-on record was created; the smoke test keeps the claim honest in the meantime.

### Post-change review

The goal is met on its own terms: the runtime dependency now selects the modern 2026-07-28 profile, and every element the record demanded — the per-connection factory, SDK-owned discovery, complete result envelopes, the smoke boundary, and the deliberate fallback — is present and independently asserted.

Scope held tighter than planned. The record's hardest question was how far the result-envelope change should reach, and the answer came from reading the SDK rather than from copying the pilot: the encode contract's `stampResultType` step adds `resultType: 'complete'` to any result that omits it, and `ki-repo-mcp` §12 scopes the requirement to the synchronous helpers. Rewriting the fifty-two inline handler envelopes would have produced no wire-level difference while enlarging the diff across precisely the modules the Boundary protects. The smoke test's `m365_about` round trip confirms this empirically — that handler builds its envelope inline, and the strict v2 client accepted it.

Regression risk is low and concentrated in two places. The tool surface is asserted identical on both eras by the only test that sees the real wire, and the type-level migration is fully covered by a clean whole-tree typecheck. The genuine residual risk is behavioural rather than structural: the per-connection factory changes instance lifetime, so a second concurrent connection now gets its own `McpServer` while sharing one token store. That is the intended design and matches the accepted pilot, but it is the change a reviewer should look at hardest.

Acceptance readiness: every step is complete, every declared gate passed, the audit still passes at 15 skills, and the two deviations are named above. The item is ready for human review. It has not been accepted, closed, pruned, pushed, or released.

### Mini recap

Delivered the protocol-profile migration for mcp-m365: v2 package family, `serveStdio` per-connection factory, explicit complete discriminators on the result helpers, a smoke boundary that proves modern discovery and the legacy fallback, and the removal of a `zod` hold whose cause had gone.

Verified against build, typecheck, lint, 1043 tests, 100% coverage on all four metrics, the live smoke boundary, knip, markdown lint, and a 15-skill repository audit — all passing.

Concerns: none blocking; one non-reproducing test failure during the dependency swap, and the standing `legacy: 'serve'` retention, both recorded above.

Proposed learning routes, offered rather than promoted: the `stampResultType` finding is the reusable part of this work — it tells the next sibling MCP that the helper-scoped requirement is genuinely helper-scoped, and that a repository whose handlers build envelopes inline does not need a fifty-file rewrite to reach the modern profile. That belongs with the family's shared `src/utils/results.ts` convention if anywhere, and is a `ki-repo-mcp` observation rather than a local one.

## Done

Accepted 2026-09-26 by Kris Brown on the review packet above.

## Discussion

### Source evidence

The portable profile and rubric live in ki-repo-mcp; the accepted mcp-git-audit migration is implementation evidence, not a patch to copy mechanically. Receiver-specific authentication, configuration, generated client, and tool-envelope differences remain local design inputs.

### Result-envelope breadth

The pilot funnels every result through `jsonResult`/`errorResult`, so stamping the discriminator there covered its whole surface. This repository does not: fifty-two success envelopes are built inline across thirty `src/main/` modules. Mechanically rewriting all of them was considered and rejected on evidence. The v2 encode contract's `stampResultType` step adds `resultType: 'complete'` to any result that omits it and only errors on a conflicting value, and `ki-repo-mcp` §12 scopes the requirement to the synchronous helpers rather than to every call site. Changing fifty-two handlers would therefore buy no wire-level difference while enlarging the diff across the exact modules the Boundary protects. The helpers carry the discriminator; the handlers are left alone.

### Compatibility fallback

`legacy: 'serve'` is a deliberate retention, not an oversight. The Boundary forbids removing legacy compatibility without evidence, and the evidence needed is fleet-wide client readiness, which this repository cannot observe. The smoke boundary therefore asserts the fallback positively — a second client that opens in the legacy era must still see the identical tool surface — so the compatibility claim is tested rather than assumed.

### Acceptance boundary

The modern profile is not claimed until this repository's package, result helpers, stdio entry point, focused tests, live smoke, and ki-repo-mcp audit agree. A passing legacy audit before migration remains expected.
