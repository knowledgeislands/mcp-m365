# AGENTS.md

## Runtime

Use Bun (>= 1.3) for installation, development, and tests; use `bun run test`, never `bun test`. The published `dist/` servers run under Node (>= 22). Keep `NODE_ENV=development` confined to development and inspector commands; production configuration comes from the host environment.

## MCP architecture

Keep configuration injectable: no module-level environment reads or configuration singleton. The MCP and OAuth servers each load configuration once and pass the smallest required slice into registration or implementation functions. Tool modules validate and adapt MCP envelopes only; implementation belongs in `src/main/`. Register every tool through the annotation-driven access gate with an explicit annotation preset.

## OAuth and data safety

Never log or return access or refresh tokens. Preserve atomic `0600` token storage, exact single-use OAuth state validation, strict provider and redirect validation, bounded attachment handling, and header-injection guards. Mutating tools expose safe defaults and tests use isolated fixtures rather than real Microsoft 365 accounts, mailboxes, calendars, drives, or token stores.

## Verification

Run `bunx tsc --noEmit`, `bun run test`, `bun run test:coverage`, `bun run build`, `bun run ki:test:smoke`, and the relevant focused `ki repo audit` commands. Live OAuth and Microsoft Graph operations require explicit authority.
