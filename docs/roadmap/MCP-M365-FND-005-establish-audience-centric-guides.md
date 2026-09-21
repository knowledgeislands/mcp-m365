---
id: MCP-M365-FND-005
area: FND
title: Establish audience-centric guides
theme: documentation-structure
blocks: []
blocked_by: []
transferred_from: ki-website
created_at: 2026-09-21T15:44:00Z
updated_at: 2026-09-21T15:44:00Z
horizon: triage
status: draft
---

## Goal

A reader can find practical instructions for this server grouped by the audience that needs them, and the repository declares `ki-guides` so that grouping is gated rather than conventional.

## Context

`mcp-m365` has no `docs/guides/` and does not declare `ki-guides`. Its 430-line README carries Quick Start, Installation, a full Azure App Registration procedure, Configuration, Authentication, Development, Security Model, Troubleshooting, and Extending the Server. The Azure registration is a long, failure-prone procedure against someone else's console — precisely the material a user guide exists to hold.

KI Website now declares, for every page it publishes under `apps/site/src/guidance/`, the exact upstream document and pinned ref that page was written from, and a `verify:guidance --network` sweep reports the pages whose source has moved. The site intends to derive public guidance for this project from this repository's own guides and cite them at a pinned ref, so the quality and stability of `docs/guides/` here directly determines the quality of what the site can publish.

That is a pull, not an obligation: KI Website derives, it does not own. This repository decides what its guides say and when they change.

Separately, `ki-guides` is being asked to require audience directories under `docs/guides/` rather than permitting a flat collection (`ki-agentic-harness` `KI-HARNESS-GOV-083`). If that lands, this repository's collection has to satisfy it.

## Boundary

This is a discussion proposal only. It is not accepted, prioritised, or implementation authority, and this repository owns its horizon and plan.

KI Website derives and cites; it does not own this collection and must not be given approval rights over it. Nothing here requires a guide to be written for the website's benefit — if a guide would not serve this repository's own readers, it should not exist.

## Shaping

- Decide the audience directories this server needs. `user/` covers someone who wants the server running against their own account; `developer/` covers someone changing its code; an `operator/` split is worth considering where running it is a separate job from using it.
- Move the README's how-to material into those guides rather than copying it. A README that both orients and instructs is the thing being consolidated, and finishing with two copies is worse than not starting.
- Leave the README as orientation: what the server is, what it can do, and where to go next. Feature lists and tool inventories can stay; step-by-step setup should not.
- Declare `[skills.ki-guides]` in `.ki.toml` and run `ki repo audit --skill ki-guides --repo .` to gate the result.
- Decide whether the tool inventory is a guide at all. It may belong in a specification or be generated from the server's own tool declarations; a hand-maintained list that drifts from the code is the usual failure.

## Discussion

Review the evidence before deciding whether to restructure now, defer, or record an exception. The prompting question is whether a reader who has never opened this repository can install it, run it, and recover from its common failures without reading source.
