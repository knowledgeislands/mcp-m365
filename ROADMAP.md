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

- Wire `bun run test:smoke` into [.github/workflows/ci.yml](./.github/workflows/ci.yml). The script is already defined in `package.json` and there's a `scripts/smoke.ts` — but CI currently only runs `lint:check`, `lint:types`, and `test:coverage`. mcp-gmail's CI step is the model to copy.
- Migrate markdown formatting from prettier to Biome once Biome ships stable markdown support (currently keeping prettier + markdownlint for `.md` because Biome 2.x doesn't format markdown yet).
- Replace hand-rolled OAuth refresh in `src/main/auth/index.ts` with `@azure/msal-node`. Roughly 300 lines of `node:https` + promise dedup + custom expiry math can collapse to a few SDK calls. Biggest remaining asymmetry vs `mcp-gmail`, which uses `googleapis` for the same work. Out of scope for an incremental change — needs careful migration of the existing token file shape and the `ensureAuthenticated` call sites.
