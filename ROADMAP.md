# Roadmap

Forward-looking plans only. Shipped features live in [README.md](./README.md); release history lives in [CHANGELOG.md](./CHANGELOG.md).

## Next Up

- Reply / reply-all
- Forward email
- Email attachment download and send-with-attachments
- Save draft reply / draft forward

## Future Advanced Capabilities

- Find free/busy or scheduling helper
- Mailbox triage helpers

## Tooling

- Migrate markdown formatting from prettier to Biome once Biome ships stable markdown support (currently keeping prettier + markdownlint for `.md` because Biome 2.x doesn't format markdown yet).
- Replace hand-rolled OAuth refresh in `src/tools/auth/token-storage.ts` with `@azure/msal-node`. Roughly 300 lines of `node:https` + promise dedup + custom expiry math can collapse to a few SDK calls. Biggest remaining asymmetry vs `mcp-gmail`, which uses `googleapis` for the same work. Out of scope for an incremental change — needs careful migration of the existing token file shape and the `ensureAuthenticated` call sites.
