---
id: MCP-M365-FND-005
title: Establish audience-centric guides
area: FND
theme: foundation-tooling
horizon: now
status: awaiting-review
blocks: []
blocked_by: []
transferred_from: ki-website
baseline_ref: 9879a4180a96e517b63c0310863c1605b1bbfde0
created_at: 2026-09-21T15:44:00Z
updated_at: 2026-09-26T17:35:30Z
---

## Goal

A reader can find practical instructions for this server grouped by the audience that needs them, and the repository declares `ki-guides` so that grouping is gated rather than conventional.

## Context

`mcp-m365` has no `docs/guides/` and does not declare `ki-guides`. Its 430-line README carries Quick Start, Installation, a full Azure App Registration procedure, Configuration, Authentication, Development, Security Model, Troubleshooting, and Extending the Server. The Azure registration is a long, failure-prone procedure against someone else's console — precisely the material a user guide exists to hold.

KI Website now declares, for every page it publishes under `apps/site/src/guidance/`, the exact upstream document and pinned ref that page was written from, and a `verify:guidance --network` sweep reports the pages whose source has moved. The site intends to derive public guidance for this project from this repository's own guides and cite them at a pinned ref, so the quality and stability of `docs/guides/` here directly determines the quality of what the site can publish.

That is a pull, not an obligation: KI Website derives, it does not own. This repository decides what its guides say and when they change.

Separately, `KI-HARNESS-GOV-083` has clarified `ki-guides`: audience directories are recommended when stable reader groups make a collection easier to navigate, while flat and mixed collections remain valid. This item therefore stands on this repository's own readers and routing needs, not a universal Harness requirement.

## Boundary

Adopted into `Now` by explicit approval, so this is prioritised work rather than intake. It was captured at `status: draft` and required `ki-plan` to shape it to `Ready` before any implementation; this repository still owns its plan and sequencing.

KI Website derives and cites; it does not own this collection and must not be given approval rights over it. Nothing here requires a guide to be written for the website's benefit — if a guide would not serve this repository's own readers, it should not exist.

## Shaping

- Decide the audience directories this server needs. `user/` covers someone who wants the server running against their own account; `developer/` covers someone changing its code; an `operator/` split is worth considering where running it is a separate job from using it.
- Move the README's how-to material into those guides rather than copying it. A README that both orients and instructs is the thing being consolidated, and finishing with two copies is worse than not starting.
- Leave the README as orientation: what the server is, what it can do, and where to go next. Feature lists and tool inventories can stay; step-by-step setup should not.
- Declare `[skills.ki-guides]` in `.ki.toml` and run `ki repo audit --skill ki-guides --repo .` to gate the result.
- Decide whether the tool inventory is a guide at all. It may belong in a specification or be generated from the server's own tool declarations; a hand-maintained list that drifts from the code is the usual failure.

### Resolved in planning

**Two audiences, `user/` and `developer/`. No `operator/`.** The server is a local stdio subprocess that an MCP client launches; there is no deployment, no service lifecycle, no host to keep alive, and no second party who runs it on someone else's behalf. The only long-lived process a reader starts by hand is the OAuth callback server, and they start it for their own sign-in. The material that reads as operational — the access-level gate, the audit log, the routing engine's filesystem roots — is configuration that the same person sets on their own machine, so it belongs in `user/configuration.md` rather than in an audience directory nobody is writing for. If this server ever gains a shared or hosted deployment, `operator/` is added then, against a real reader.

**The tool inventory does not become a guide.** A list of tools answers _what the server exposes_, which the four-doc split places outside `docs/guides/`; and the authoritative inventory already exists in executable form, as the server's own `tools/list` response and `m365_about`. A hand-maintained copy under `docs/guides/` would be a second inventory with no test holding it to the first, and a guide that is confidently wrong about a tool name is worse than a guide that never claimed to list them. The README keeps its capability tables, which the Shaping brief explicitly permits, with a sentence naming `tools/list` as authoritative. No `docs/specs/` corpus is manufactured to hold the surface either; whether this repository should adopt `ki-specs` is a separate decision, recorded below as a question for a human rather than answered here.

**The routing engine's procedure moves; its capability summary stays.** The README's routing-engine material is two things welded together: a description of what the engine is, which orients, and the rule DSL, the destinations block, the filesystem roots, and the report-then-live run loop, which instruct. The instructing half moves to `user/email-routing.md`. The description and the four-tool table stay in the README.

**Two developer guides, not four.** `developer/definition-of-done.md` and `developer/releasing.md` are optional under the general `ki-guides` standard and no repository-kind overlay requires them here. This repository has no documented release procedure to write down and the named gaps in this record are installation, credentials, and recovery, so inventing a release guide now would be describing a process rather than recording one. That gap is noted, not filled.

## Current state

There is no `docs/guides/` directory. `docs/` holds only `docs/roadmap/` (eleven records plus `_ISSUES.md`) and `docs/decisions/` (one Decision Record plus its index), so the `how` corner of the four-doc split is empty and unclaimed. `.ki.toml` declares fifteen skills and no `[skills.ki-guides]` block, so nothing gates whether the collection exists or what shape it takes.

`README.md` is 430 lines across seventeen H2 sections. Of those, six are pure procedure — Quick Start, Installation, Azure App Registration, Configuration, Authentication, Development, Troubleshooting, and Extending the Server — and a reader arriving with a task has to reconstruct that task out of reference prose interleaved with them. `Directory Structure` is contributor orientation sitting in a document a user reads first.

`CLAUDE.md` states in its opening line that "the user-facing tool surface, Azure app setup, install/config, and Claude Desktop setup live in README.md". That sentence stops being true the moment this item lands and has to move with the material.

Two figures in the README are already wrong. The `MCP_M365_ACCESS_LEVEL` footnote claims `destructive` "adds 9 delete, retention and harvest tools — all 37 tools registered". The source registers 36 tools: 12 derive `read`, 16 derive `write`, and 8 derive `destructive`. The four capability tables themselves list exactly 36 and are correct; only the footnote drifted. Moving that footnote into a guide is not an occasion to carry a known-false number across.

`ki repo audit --concise --progress never` currently passes at 15 skills. Declaring `ki-guides` takes that to 16, and it must still pass.

## Steps

- [x] Create `docs/guides/README.md` as the collection entry point: what the collection covers, a route to each audience, and a statement of what lives in `docs/decisions/` and `docs/roadmap/` instead. It routes by audience and carries no procedure of its own.
- [x] Create `docs/guides/user/README.md` and `docs/guides/developer/README.md`, each introducing its audience and giving a substantive route into every guide beneath it.
- [x] Write `docs/guides/user/azure-app-registration.md` from the README's `Azure App Registration` section, extended with the prerequisites it assumes, what each delegated permission buys, the failures the Azure console actually produces, and what to do when a client secret expires.
- [x] Write `docs/guides/user/installation.md` from the README's `Quick Start`, `Installation`, and `Claude Desktop Configuration` material, as one ordered route from an empty machine to a connected client, ending in a verification a reader can run.
- [x] Write `docs/guides/user/authentication.md` from the README's `Authentication` section: the auth-server handshake, where tokens land, how refresh works, and how to force re-authentication or revoke access.
- [x] Write `docs/guides/user/configuration.md` from the README's `Environment Variables` table and its footnotes, with the access-level gate, the audit log, and the `.env` precedence rules stated as choices a reader makes. Correct the tool counts to 12 / 16 / 8 and 36 while moving them.
- [x] Write `docs/guides/user/email-routing.md` from the README's `Email routing engine`, `Saving attachments`, `Rule DSL (v1)`, and `Email folder targeting` material: roots, the rule file, report-then-live, the resumable batch loop, and drift.
- [x] Write `docs/guides/user/troubleshooting.md` from the README's `Troubleshooting` section, extended to cover the failures the new guides introduce a reader to — consent, tenant, redirect-URI mismatch, secret expiry, access-level surprises, and a refused routing path.
- [x] Write `docs/guides/developer/local-development.md` from the README's `Development`, `Running From Source (Dev)`, and `Directory Structure` sections, plus the verification gates `AGENTS.md` already names.
- [x] Write `docs/guides/developer/extending-the-server.md` from the README's `Extending the Server` section, with the annotation-driven access gate and the `main/` versus `tools/` boundary stated as the constraints they are.
- [x] Reduce `README.md` to orientation: what the server is, what it can do, the capability tables, the example conversations, the security model, and a route into `docs/guides/`. Every moved section is deleted, not summarised in place.
- [x] Update `CLAUDE.md`'s pointer so it names `docs/guides/` for user-facing setup and keeps `README.md` only for the tool tables. Leave the protocol-profile corrections in that file untouched.
- [x] Declare `[skills.ki-guides]` in `.ki.toml` under the governance block, beside `ki-decision-records`.
- [x] Run the gates and repair what they report.

## Files touched

- `docs/guides/README.md` — new collection entry point.
- `docs/guides/user/README.md`, `docs/guides/user/azure-app-registration.md`, `docs/guides/user/installation.md`, `docs/guides/user/authentication.md`, `docs/guides/user/configuration.md`, `docs/guides/user/email-routing.md`, `docs/guides/user/troubleshooting.md` — new user collection.
- `docs/guides/developer/README.md`, `docs/guides/developer/local-development.md`, `docs/guides/developer/extending-the-server.md` — new developer collection.
- `README.md` — eight procedural sections removed, orientation and capability tables retained, guide routes added.
- `CLAUDE.md` — one pointer sentence.
- `.ki.toml` — `[skills.ki-guides]`.
- `.env.example` — two comment lines that pointed at `README.md` for setup and at a README section name that no longer exists.
- `docs/roadmap/MCP-M365-FND-005-establish-audience-centric-guides.md` — this record.

No file under `src/` changes. This item moves documentation and declares a skill; it touches no behaviour, no test, and no build output.

## Verify

- `ki repo audit --skill ki-guides --concise --progress never` — passes over the new collection, confirming the root, the entry point, the guide headings, and the absence of a retired `docs/spec/` or `docs/developer/` sibling.
- `ki repo audit --skill ki-authoring --concise --progress never` — passes over every new and edited Markdown file.
- `bunx rumdl check` — no issues across the repository's authored Markdown.
- `ki repo audit --concise --progress never` — PASS, now at 16 skills rather than 15, with no regression in any previously passing skill.
- Reader check, by judgment rather than by tool: from `docs/guides/README.md` alone, a reader who has never opened this repository can reach the Azure registration, complete it, connect a client, authenticate, and recover from a failed sign-in without opening `src/` or `README.md`.

## Dependencies / blocks

Nothing blocks this item and `blocked_by` stays empty. The collection is new files plus edits to three existing ones, and every gate it must pass is already installed and green.

`KI-HARNESS-GOV-083` is advisory rather than a universal migration requirement. This collection's user and developer grouping remains a repository-local choice supported by its distinct readers. The Harness item is neither a blocker nor a receiver.

KI Website intends to derive public guidance from these guides and cite them at a pinned ref. It derives rather than owns and its schedule does not gate this work; no handoff item is created in either direction by this record.

`MCP-M365-FND-002` is `awaiting-review` on the same branch and touches `src/`, `package.json`, `.ki.toml`'s dependency holds, and `CHANGELOG.md`. This item touches `docs/`, `README.md`, `CLAUDE.md`, and a new `.ki.toml` skill block, so the two share no content; the `.ki.toml` edit is an addition in a different block.

## Documentation impact

### Decision Records

No decision record is needed. Audience-centric grouping is the house arrangement `ki-guides` already encodes, so adopting it here is conformance rather than a new decision. One becomes owed only if this repository concludes it needs an exception.

### Specifications

No behaviour-level contract changes. The server's tool surface is untouched; this item changes only where its instructions live and who they are written for. It deliberately does not create a `docs/specs/` corpus: the guides route to the README's capability tables and to the server's own `tools/list` for the surface, and the `ki-specs` question is raised as an open one rather than pre-empted.

### Guides

This item is entirely guide impact. It creates the collection, its two audience directories, their indexes, and nine guides, and it empties the README of instruction.

### Roadmap

No further roadmap change is expected. If writing the guides exposes behaviour that cannot honestly be explained — an unclear failure mode, a configuration step with no recovery — that is a separate item raised at the time.

## Review

### Delivered

The approved boundary held: a `docs/guides/` collection with `user/` and `developer/` audience directories, the README's procedural material moved rather than copied, `[skills.ki-guides]` declared in `.ki.toml`, and the `CLAUDE.md` pointer corrected. Nothing under `src/`, `tests/`, or the build configuration was touched, and no behaviour changed.

Excluded, as planned: no tool-inventory guide and no `developer/releasing.md`. Both exclusions are stated in `docs/guides/README.md` under "What is not here" rather than left as a silent gap, so a reader who looks for either finds out why it is absent and where the answer actually lives.

Baseline: `9879a4180a96e517b63c0310863c1605b1bbfde0` (the planning commit, tree clean). Resulting evidence: the commit recorded in `Verification` below, eleven new files under `docs/guides/`, and five edited files.

### Change Summary

Eleven new files, 857 lines: `docs/guides/README.md` (collection entry point, routes by audience and carries no procedure), `docs/guides/user/README.md`, `docs/guides/user/azure-app-registration.md`, `docs/guides/user/installation.md`, `docs/guides/user/authentication.md`, `docs/guides/user/configuration.md`, `docs/guides/user/email-routing.md`, `docs/guides/user/troubleshooting.md`, `docs/guides/developer/README.md`, `docs/guides/developer/local-development.md`, `docs/guides/developer/extending-the-server.md`.

`README.md` fell from 430 lines to 159. Eight sections were deleted outright — `Quick Start`, `Installation`, `Azure App Registration`, `Configuration`, `Authentication`, `Development`, `Directory Structure`, `Troubleshooting`, `Extending the Server`, the `Rule DSL (v1)` block, and the second JSON block under email folder targeting. What remains is orientation: what the server is, the four capability tables, the example conversations, the security model, and three numbered routes into `docs/guides/`.

`.ki.toml` declares `[skills.ki-guides]` in the governance block beside `ki-decision-records`. `CLAUDE.md`'s opening pointer now names `docs/guides/` for setup and sign-in and keeps `README.md` for the tool surface; the two protocol-profile corrections in that file were left untouched. `.env.example` lost two stale pointers into README sections that no longer exist.

Three material decisions were taken during implementation rather than in planning.

**The tool counts were wrong and were corrected at the point of moving them.** The README's `MCP_M365_ACCESS_LEVEL` footnote claimed `destructive` "adds 9 delete, retention and harvest tools — all 37 tools registered". A scan of `src/tools/**/*.ts` for `registerTool(...)` with its `annotations:` preset gives 36 tools: 12 derive `read`, 16 derive `write`, 8 derive `destructive`. The guides carry 12 / 28 / 36 as the cumulative registration counts, and the README's own prose was corrected to match.

**`m365_auth_start` is not available at the default access level, so the guides do not lead with it.** `levelFromAnnotations` in `src/utils/access-level.ts` derives a tool's level from its annotations, and `m365_auth_start` is `WRITE_REMOTE` because it persists tokens to disk — so at the default `MCP_M365_ACCESS_LEVEL=read` it is never registered. A first sign-in therefore cannot start from inside the MCP client on a default installation. `src/auth-server/index.ts` serves a `GET /auth` route that mints a fresh single-use state and a PKCE S256 verifier and redirects to Microsoft; that route is unaffected by the access level. `authentication.md` leads with <http://localhost:3333/auth> and explains the tool route as the alternative; `installation.md`, `troubleshooting.md`, and `azure-app-registration.md` were swept for the same assumption.

**No specification was manufactured.** `docs/specs/` does not exist here and this item did not create one. Where a gap is genuinely specification-shaped — an authoritative tool inventory — the guides say so and point at the server's own `tools/list` response as the authority, rather than starting a corpus that would immediately drift.

- Review remediation removed outbound Markdown-document links from the guide index and three developer guides. Required procedure remains local through sibling-guide routes; root `README.md`, `AGENTS.md`, `CLAUDE.md`, `CHANGELOG.md`, `docs/decisions/`, and `docs/roadmap/` are named without becoming dependencies.
- Root `README.md` and `AGENTS.md` already link inward to the guide collection, so no root-document change was needed.

### Verification

- `ki repo audit --skill ki-guides --concise --progress never` — `summary: KI REPO AUDIT on mcp-m365 PASS · 1 skill`
- `ki repo audit --skill ki-authoring --concise --progress never` — `summary: KI REPO AUDIT on mcp-m365 PASS · 1 skill`
- `bunx rumdl check` — `Success: No issues found in 36 files (20ms)`
- `ki repo audit --concise --progress never` — `summary: KI REPO AUDIT on mcp-m365 PASS · 16 skills`, up from 15 exactly as predicted, with no previously passing skill regressing.
- Reader check, by judgment: from `docs/guides/README.md` alone a reader reaches the Azure registration, completes it, connects a client, signs in through the browser, and recovers from the common failures without opening `src/` or `README.md`. Every factual claim carried out of the README was re-read against source — the scope list, the defaults, the counts, the script bodies, the error strings, and the coverage thresholds.

No test, build, or lint gate covers `src/`, because no file under `src/` changed.

#### GUIDE-4 review remediation

- The exact outbound-document predicate over `docs/guides/` returned no matches.
- `ki repo audit --skill ki-guides --repo . --concise --progress never` → `summary: KI REPO AUDIT on mcp-m365 PASS · 1 skill`.
- `ki repo audit --skill ki-authoring --repo . --concise --progress never` → `FAIL=0 WARN=1`; the sole warning is pre-existing `.rumdl.toml` template drift (`OWN-1`), with no authored-Markdown finding.
- Runtime tests and builds were not repeated because remediation changes only guides and this review record; the original runtime evidence above remains applicable.

### Outstanding concerns

**`m365_auth_start` at the default access level is an ergonomics problem the guides document rather than fix.** A fresh installation registers twelve read tools, none of which can authenticate, and the 401 hint in `src/utils/errors.ts` tells the reader to "Run the m365_auth_start tool" — a tool their server has not registered. The guides now route around this honestly, but the hint text is misleading on a default installation and the fix is a code change outside this item's boundary. It is worth a separate item.

**No release procedure is written down.** `ki-guides` treats `developer/releasing.md` as optional and it was deliberately not invented; there is no documented release process to describe. If one exists tacitly, the guide is owed and someone who knows it has to write it.

**The README's capability tables remain hand-maintained.** They are correct today, verified against the registrations. Nothing prevents them drifting from `src/tools/` tomorrow. Generating them, or replacing them with a pointer to `tools/list`, is the durable fix and is not in this item.

**A pre-existing link-check failure was not introduced and not fixed.** `CLAUDE.md` links `../mcp-gmail/src/utils/paths.ts`, a sibling repository that is not present. It predates this item and is out of its boundary.

### Post-change review

The goal is met. A reader can find practical instructions grouped by audience, and `ki-guides` gates the grouping rather than convention holding it together — that gate is now green and is part of the 16-skill audit, so a future regression fails the repository's habitual check rather than going unnoticed.

Scope held. The one place the work pressed on its boundary was the `m365_auth_start` discovery: writing an honest sign-in guide surfaced a real defect in the default experience. The boundary was respected by documenting the working route and raising the defect as a concern rather than editing `src/`.

Regression risk is low and confined to documentation. No runtime file changed. The residual risk is factual drift rather than breakage: the tool counts, the capability tables, and the environment-variable defaults are now asserted in two places, and the guides are only as true as the next person keeps them.

Acceptance readiness: ready for human review. Terminal closure is not this skill's to take, and two of the concerns above — whether a `ki-specs` corpus should exist here, and whether a release guide is owed — are decisions for a human rather than defects to fix.

### Mini recap

Delivered an eleven-file audience-centric guide collection, moved 271 lines of procedure out of the README, declared `ki-guides`, and corrected two factual errors found in the material being moved.

Verified with the four stated gates, all passing verbatim as recorded above.

Concerns: the `m365_auth_start` default-level trap and its misleading 401 hint; no documented release procedure; hand-maintained tool tables with no drift check.

Proposed learning routes, offered rather than promoted: the general lesson that moving documentation is the moment its claims get audited — two wrong numbers and one wrong instruction had survived in the README precisely because nobody had to re-read them; and that a security gate derived from annotations can exclude the tool a user needs first, which is a design pattern worth checking for in the sibling MCP servers that share this access-level model.

## Discussion

Shaping settles how far the restructure goes, not whether it happens. The prompting question is whether a reader who has never opened this repository can install it, run it, and recover from its common failures without reading source.

### Why the move must be a move

The failure mode this item is most exposed to is a README that keeps its procedures "for convenience" while the guides gain a second copy. Two copies diverge on the first correction, and the one a reader lands on is the one a search engine or a cross-repository citation happened to pick. So every section named in Steps is deleted from the README in the same change that creates its guide, and the README's route into `docs/guides/` is the only instruction it retains.

### Where the honesty gates are

Three things in the moved material are claims about the code rather than about the reader's machine: the tool counts in the access-level footnote, the default scope list, and the default paths for tokens, the audit log, and the triage tracking cache. Each was checked against `src/` while planning, and the counts were found wrong. Nothing else moves without the same check.
