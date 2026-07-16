---
id: '001'
title: Adopt uniform governance modes and bootstrap
status: in-progress
roadmap: foundation-tooling/adopt-uniform-governance-modes-and-bootstrap
blocks: —
blocked-by: —
---

## Context

This MCP repository is in the final auth and record/replay cohort of the harness uniform-mode rollout. Its legacy aggregate audit delegates to removed project-local skill scripts. The harness coordinating plan `foundation-tooling/004` governs the fleet recipe; this plan governs this repository's package, bootstrap, and generated-payload migration.

## Current state

The repository adopted the current five-skill governance baseline: `ki-authoring`, `ki-engineering`, `ki-mcp`, `ki-project-roadmap`, and `ki-repo`. The generated `.ki-meta/` payload now supplies the canonical aggregate commands; the historical checked-in `scripts/ki/` wrappers have been removed without changing auth-server, record, replay, server, generator, or smoke-test commands. `bun run ki:audit`, `bun run test` (551 passing tests), `bun run test:coverage` (100% across all metrics), `bun run ki:test:smoke` (32 tools and schemas), and the bootstrap audit all pass. The rollout exposed one pre-existing uncovered folder-list sort branch; a focused handler test now covers it.

## Steps

1. [x] Add the `ki-project-roadmap` coverage declaration and re-bootstrap from the current harness, publishing only the declared generated runtime payloads.
2. [x] Reconcile `package.json` and CI with the canonical generated aggregate and per-skill commands, preserving auth-server, record, replay, server, generator, and smoke-test commands.
3. [x] Run the focused bootstrap, project-roadmap, engineering, authoring, MCP, test, and aggregate gates; classify every failure as repository drift or a harness defect.
4. [ ] Commit the validated migration and report the outcome to the harness coordinating plan.

## Files touched

`.ki-config.toml`, `.ki-meta/`, `.markdownlint-cli2.jsonc`, `knip.json`, `package.json`, `.github/workflows/ci.yml`, `src/main/folder/folder-handlers.test.ts`, retired `scripts/ki/` wrappers, `ROADMAP.md`, and `docs/roadmap/`.

## Verify

`bun run test`, `bun run ki:test:smoke`, the focused artifact audits, and `bun run ki:audit` pass; the thematic roadmap audit passes; and no auth, record, replay, or MCP source behaviour changes.

## Dependencies / blocks

This repository follows four successful migrations under harness plan `foundation-tooling/004`. It is unblocked by local state. A failure that shows the harness contract is incomplete returns to `ki-agentic-harness`; this repository does not invent a consumer-side workaround.
