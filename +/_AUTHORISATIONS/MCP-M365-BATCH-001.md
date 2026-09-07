---
id: MCP-M365-BATCH-001
repository: https://github.com/knowledgeislands/mcp-m365
approved: true
approved_at: 2026-09-07T21:10:11Z
authority_mode: outcome
authority_evidence: User approved the governed GOV-054 estate rollout and instructed immediate execution under the committed Harness worker packet at 2179f1d2.
approved_payload_sha256: 207482c2511a8522e04bf7f4623d441b7d1f13248e5463ead9a2ffffbbe20db2
run_id: MCP-M365-BATCH-001-RUN-001
timebox_ends_at: 2026-09-08T00:10:11Z
item_ids: [MCP-M365-FND-004]
completion_target: awaiting-review
mandatory_stops:
  - material-scope-expansion
  - destructive-or-irreversible-work
  - external-coordination
  - verification-failure
  - public-command-name-change
  - push-or-release
---

# MCP-M365-BATCH-001 — Remove obsolete MCP exclusions

## Outcome authority

Deliver `MCP-M365-FND-004` through its verified local implementation boundary and stop at `awaiting-review`. Keep package-script changes, external systems, closure, pruning, pushing, and release outside the run.

## Selected plan

1. `MCP-M365-FND-004` — remove the exact four now-obsolete `ki-repo-mcp` script exclusions while preserving every command and all runtime behaviour.

## Scope

Mutable paths are limited to `.ki.toml`, `docs/roadmap/_ISSUES.md`, `docs/roadmap/MCP-M365-FND-004-remove-obsolete-mcp-script-exclusions.md`, and `+/_AUTHORISATIONS/MCP-M365-BATCH-001.md` in this repository.

## Required verification

- Focused `ki-engineering`, `ki-repo-mcp`, and `ki-work-roadmap` audits.
- `bunx tsc --noEmit` and `bun run test`.
- TOML parsing, package-script equality, and `git diff --check`.

## Allowed decisions and delegation

Remove only the four locked exclusions after central claim commit `de881b6d`. Package command names and bodies are locked. No runtime delegation is authorised; the coordinator executes the bounded change serially.

## Completion and remedial policy

The item stops at `awaiting-review` with the canonical six-heading review packet. This authorisation grants no closure or pruning authority. A failed required gate, external need, or wider change stops the run; non-blocking unrelated drift becomes separately reviewed work.

## Run ledger

<!-- ki-batch-run: MCP-M365-BATCH-001-RUN-001 207482c2511a8522e04bf7f4623d441b7d1f13248e5463ead9a2ffffbbe20db2 -->

## Run outcome

- `MCP-M365-FND-004` began Ready at immutable baseline `8ef38932649b2f1325624a33b33071e7f886196c` and reached `awaiting-review` after implementation commit `bb5a01969340a27c6ee3fa86913c9714c93b1aff`.
- Focused `ki-engineering` and roadmap audits passed; the focused MCP audit retained one pre-existing `CFG-1` warning and no failures. TypeScript passed; 30 test files and 947 tests passed; TOML parsing, package-script equality, Markdown, and diff checks passed.
- No decision beyond the locked four-exclusion removal was taken, no delegation was used, and no external command, push, release, closure, or prune occurred.
- Next action is human review through `ki-accept`; this authorisation grants no closure authority. The existing MCP warning remains receiver-owned follow-up outside this run.
