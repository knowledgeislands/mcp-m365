---
id: MCP-M365-FND-004
area: FND
title: Remove MCP exclusions
theme: foundation-tooling
horizon: next
status: ready
blocks: []
blocked_by: []
baseline_ref: null
---

## Goal

Recognise the repository's authentication and integration-recording commands as MCP-owned capabilities without obsolete local exceptions.

## Context

Harness commit `de881b6d` assigns `ki:server:auth:dev`, `ki:server:auth:start`, `ki:test:record`, and `ki:test:replay` to `ki-repo-mcp`. This repository already implements those exact commands and currently lists them under `[skills.ki-engineering].script_exclusions`, which now fails `SCR-3` because exclusions cannot overlap the `ki:` capability namespace.

## Boundary

Remove only the four obsolete exclusions. Do not rename or change package scripts, start an authentication server, record or replay an integration session, contact an external system, close this record, prune it, or push.

## Current state

The selected local adapter is `roadmap`, the central claim prerequisite has landed, the work tree is clean at receiver baseline `67a63b98cd45cd329bf508e7c3ee3c4cd6713e1e`, and focused `ki-work` and `ki-work-roadmap` audits pass. The focused engineering audit has one expected `SCR-3` failure naming exactly the four obsolete exclusions. The focused MCP audit has one pre-existing `CFG-1` warning for `src/main/auth/index.ts` reading `process.env` outside `config/`; this cleanup does not alter that path.

## Steps

- [ ] Remove the exact `script_exclusions` key while preserving `dependency_holds` and every other `.ki.toml` value.
- [ ] Prove the four package script names and bodies remain unchanged.
- [ ] Run the required focused audits, TypeScript check, tests, TOML parse, and diff check.
- [ ] Record the canonical review packet and bound batch-run evidence, then stop at `awaiting-review`.

## Files touched

- `.ki.toml`
- `docs/roadmap/_ISSUES.md`
- `docs/roadmap/MCP-M365-FND-004-remove-obsolete-mcp-script-exclusions.md`
- `+/_AUTHORISATIONS/MCP-M365-BATCH-001.md`

## Verify

Run `ki repo audit --skill ki-engineering --repo .`, `ki repo audit --skill ki-repo-mcp --repo .`, `bunx tsc --noEmit`, `bun run test`, `ki repo audit --skill ki-work-roadmap --repo .`, a TOML parse with a package-script equality assertion, and `git diff --check`.

## Dependencies / blocks

Harness commit `de881b6d` satisfies the sole external prerequisite by publishing the four exact MCP script claims. Execution is coordinator-only because `ki-delegation` is not declared or resolved in this receiver, and this one-file implementation does not benefit from a delegated lane.

## Documentation impact

### Decision Records

No decision record change is needed; the harness engineering and MCP standards already own the namespace decision.

### Specifications

No specification changes are needed because package commands and runtime behaviour remain unchanged.

### Guides

No guide changes are needed because existing command names and usage remain unchanged.

### Roadmap

This receiver-owned record and its batch authorisation provide the durable implementation and review evidence. No follow-on item is planned unless verification reveals unrelated work.

## Discussion

### Ownership classification

All four commands are conditional MCP capability operations backed by `src/auth-server/index.ts` and the paired `scripts/integration.ts` recording harness. They remain `ki:` commands; neither `self:` renaming nor a bare external exception is appropriate.
