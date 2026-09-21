---
id: MCP-M365-FND-005
title: Establish audience-centric guides
area: FND
theme: foundation-tooling
horizon: now
status: draft
blocks: []
blocked_by: []
transferred_from: ki-website
baseline_ref: null
created_at: 2026-09-21T15:44:00Z
updated_at: 2026-09-21T16:40:00Z
---

## Goal

A reader can find practical instructions for this server grouped by the audience that needs them, and the repository declares `ki-guides` so that grouping is gated rather than conventional.

## Context

`mcp-m365` has no `docs/guides/` and does not declare `ki-guides`. Its 430-line README carries Quick Start, Installation, a full Azure App Registration procedure, Configuration, Authentication, Development, Security Model, Troubleshooting, and Extending the Server. The Azure registration is a long, failure-prone procedure against someone else's console — precisely the material a user guide exists to hold.

KI Website now declares, for every page it publishes under `apps/site/src/guidance/`, the exact upstream document and pinned ref that page was written from, and a `verify:guidance --network` sweep reports the pages whose source has moved. The site intends to derive public guidance for this project from this repository's own guides and cite them at a pinned ref, so the quality and stability of `docs/guides/` here directly determines the quality of what the site can publish.

That is a pull, not an obligation: KI Website derives, it does not own. This repository decides what its guides say and when they change.

Separately, `ki-guides` is being asked to require audience directories under `docs/guides/` rather than permitting a flat collection (`ki-agentic-harness` `KI-HARNESS-GOV-083`). If that lands, this repository's collection has to satisfy it.

## Boundary

Adopted into `Now` by explicit approval, so this is prioritised work rather than intake. It remains `status: draft`: `ki-plan` shapes it to `Ready` before any implementation, and this repository still owns its plan and sequencing.

KI Website derives and cites; it does not own this collection and must not be given approval rights over it. Nothing here requires a guide to be written for the website's benefit — if a guide would not serve this repository's own readers, it should not exist.

## Shaping

- Decide the audience directories this server needs. `user/` covers someone who wants the server running against their own account; `developer/` covers someone changing its code; an `operator/` split is worth considering where running it is a separate job from using it.
- Move the README's how-to material into those guides rather than copying it. A README that both orients and instructs is the thing being consolidated, and finishing with two copies is worse than not starting.
- Leave the README as orientation: what the server is, what it can do, and where to go next. Feature lists and tool inventories can stay; step-by-step setup should not.
- Declare `[skills.ki-guides]` in `.ki.toml` and run `ki repo audit --skill ki-guides --repo .` to gate the result.
- Decide whether the tool inventory is a guide at all. It may belong in a specification or be generated from the server's own tool declarations; a hand-maintained list that drifts from the code is the usual failure.

## Current state

There is no `docs/guides/` directory and `.ki.toml` declares no `[skills.ki-guides]` block, so nothing gates whether the collection exists or what shape it takes. The practical material catalogued in Context sits in `README.md`, where a reader arriving with a task has to reconstruct that task out of reference prose.

## Steps

- [ ] Name the audiences this server actually has, and reject any audience nobody is writing for.
- [ ] Create `docs/guides/README.md` as the collection index, routing by audience and nothing else.
- [ ] Create one directory per named audience, each with its own `README.md`.
- [ ] Move the README's how-to material into the guide that owns it, leaving the README to orient and link.
- [ ] Write what is missing: installation and client configuration, the credentials the server needs, and recovery from its common failures.
- [ ] Declare `[skills.ki-guides]` in `.ki.toml`.
- [ ] Run the guides audit and repair what it reports.

## Files touched

`docs/guides/` (new), `.ki.toml`, `README.md`.

## Verify

`ki repo audit --skill ki-guides --repo .` passes, and `ki repo audit --skill ki-authoring --repo .` passes over the new Markdown.

## Dependencies / blocks

Nothing blocks this. `KI-HARNESS-GOV-083` in `ki-agentic-harness` proposes making audience directories a `ki-guides` requirement: if it lands first this collection satisfies it by construction, and if it lands later this collection already conforms. KI Website intends to derive public guidance from these guides and cite them at a pinned ref, but it derives rather than owns and its schedule does not gate this work.

## Documentation impact

### Decision Records

No decision record is needed. Audience-centric grouping is the house arrangement `ki-guides` already encodes, so adopting it here is conformance rather than a new decision. One becomes owed only if this repository concludes it needs an exception.

### Specifications

No behaviour-level contract changes. The server's tool surface is untouched; this item changes only where its instructions live and who they are written for.

### Guides

This item is entirely guide impact. It creates the collection, its audience directories, and their indexes, and it empties the README of instruction.

### Roadmap

No further roadmap change is expected. If writing the guides exposes behaviour that cannot honestly be explained — an unclear failure mode, a configuration step with no recovery — that is a separate item raised at the time.

## Discussion

Shaping settles how far the restructure goes, not whether it happens. The prompting question is whether a reader who has never opened this repository can install it, run it, and recover from its common failures without reading source.
