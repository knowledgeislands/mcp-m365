# Roadmap

Forward-looking plans only. Shipped features live in [README.md](./README.md); release history lives in the git log.

## Next Up

- Reply / reply-all
- Forward email
- Email attachment download and send-with-attachments
- Save draft reply / draft forward

## Future Advanced Capabilities

- Find free/busy or scheduling helper
- Mailbox triage helpers

## Tooling

- Bring vitest coverage thresholds up to 100% to match the sibling MCPs (kb-fs / housekeeping / git-audit / gmail / voicenotes-edit). Current floor in [vitest.config.ts](./vitest.config.ts) is 95/85/97/94. Major gaps: `email/search.ts` (~60 uncovered lines around filter/sort/pagination), `folder/move.ts` and `folder/list.ts` (~10–20 each), plus a long tail of `?? '?'` defensive defaults in dry_run preview strings and `audit-log.ts` rotation arms. The defensive arms are candidates for `/* v8 ignore */` rather than tests.
- Migrate markdown formatting from prettier to Biome once Biome ships stable markdown support (currently keeping prettier + markdownlint for `.md` because Biome 2.x doesn't format markdown yet).
- Replace hand-rolled OAuth refresh in `src/tools/auth/token-storage.ts` with `@azure/msal-node`. Roughly 300 lines of `node:https` + promise dedup + custom expiry math can collapse to a few SDK calls. Biggest remaining asymmetry vs `mcp-gmail`, which uses `googleapis` for the same work. Out of scope for an incremental change — needs careful migration of the existing token file shape and the `ensureAuthenticated` call sites.
