# Extend the server

Use this guide when adding a tool to `mcp-m365`, whether into an existing service module or as a new one. It assumes a working checkout as prepared in [Local development](local-development.md).

Most of the work is not writing the handler. It is deciding where the implementation goes, choosing an annotation preset honestly, and wiring the registration so the access gate sees it. Getting the annotation wrong is the failure with the worst consequences and the quietest symptoms, so it gets a section of its own below.

## Decide where the code goes

The implementation goes in `src/main/<concern>/`, as a function that takes the config slice or specific primitive it needs, returns data, and prints nothing. The registration goes in `src/tools/<service>/index.ts`, which declares the schema and the annotations and imports the handler. There is no logic and no non-`index.ts` file under `src/tools/`.

This split is what lets the same implementation be used from a script or a sibling package through the `exports` map, and it is what makes 100% coverage achievable: the registration shells are coverage-excluded precisely because they contain nothing to test, and that stays true only if you keep them empty.

Route every Microsoft Graph call through [`src/main/graph-client/index.ts`](../../../src/main/graph-client/index.ts). It centralises retries and the 401-to-refresh path, so a call that bypasses it will work in development and fail the first time a token expires.

## Name the tool

Tool names follow `<app>_<resource>_<action>` in snake case, with `<app>` fixed at `m365`. The resource is compound here — a `<service>_<thing>` pair with the service being `email`, `calendar`, or `onedrive` — so a full name reads `m365_email_message_get`, `m365_calendar_event_create`, `m365_onedrive_item_upload`.

Use the plural resource for collection operations and the singular for single-item operations: `m365_email_messages_list` against `m365_email_message_get`. The auth and metadata tools drop the resource segment entirely.

## Choose the annotation preset honestly

Every tool must set `annotations` to one of the presets in [`src/utils/annotations.ts`](../../../src/utils/annotations.ts). The access gate derives the tool's level from those annotations, not from its name:

| Annotations | Derived level |
| --- | --- |
| `readOnlyHint: true` | `read` |
| `destructiveHint: true` | `destructive` |
| explicit `readOnlyHint: false` **and** `destructiveHint: false` | `write` |
| anything else, including unannotated or partially annotated | `destructive`, as a fail-safe |

Which preset to reach for:

- `READ_ONLY` / `READ_ONLY_REMOTE` — pure reads. The `_REMOTE` suffix marks open-world, meaning the tool calls an external API.
- `WRITE_REMOTE` / `WRITE_IDEMPOTENT_REMOTE` — non-destructive Graph mutations. Use the idempotent form only when repeating the call genuinely converges on the same end state, as marking a message read does; use the plain form for create-new and rename operations, which do not.
- `DESTRUCTIVE_REMOTE` — deletes whose end state is the same however often they run.
- `DESTRUCTIVE_ONESHOT_REMOTE` — where a repeat does more work rather than converging, as the batch-bounded routing passes do by processing the _next_ batch on each call.

The annotation must be honest about what the tool does, not about how it feels. `m365_auth_start` is `WRITE_REMOTE` rather than `READ_ONLY_REMOTE` because it persists tokens to disk; annotating it as a read would classify it as `read` under the gate and register it, silently, on every default installation. That is the shape of mistake this guide exists to prevent: the failure is not an error at runtime, it is a tool becoming reachable to callers who were never meant to reach it.

Annotations are also what MCP clients use to decide whether to prompt before invoking a tool, so an honest annotation is what earns the user's confirmation step.

## Wire the registration

For a new tool in an existing module, add a `server.registerTool(...)` call to that module's `index.ts` and export the handler from the matching `main/` concern.

For a whole new module:

1. Create a new directory under [`src/tools/`](../../../src/tools/) with an `index.ts`.
2. Implement the handlers under `src/main/<concern>/`, each validating its input with a strict Zod schema — `.strict()`, so that unknown arguments are rejected rather than ignored — and each setting an explicit annotation preset at its registration site.
3. Export a `register<Service>Tools(server, …)` function from the module's `index.ts`.
4. Re-export it from [`src/tools/index.ts`](../../../src/tools/index.ts).
5. Wire it into [`src/mcp-server/index.ts`](../../../src/mcp-server/index.ts) alongside the existing `register*Tools(...)` calls, inside the per-connection factory.

Register through the access-gated proxy that the entry point already builds. Do not call the underlying `McpServer` directly: bypassing the proxy skips both the access gate and the audit log, and neither omission is visible from the tool's own behaviour.

The `register*Tools(...)` calls belong inside the per-connection factory, because the `McpServer` instance and the gate wrapped around it belong to one connection. Connection-independent state — config, token storage, the Graph and triage contexts — stays at module scope above the factory. Rebuilding token storage per connection would fragment the refresh path.

## Verify a new tool

- `bun run test` and `bun run test:coverage` — the handler under `main/` must reach 100% on all four metrics, including its error branches. The registration shell is coverage-excluded and needs no test of its own.
- `bun run ki:test:smoke` — proves the tool is actually registered and reachable over the wire at the access level the smoke test configures.
- `bun run ki:server:mcp:inspect` — confirms the tool's schema and annotations render as intended in a real client. A tool missing here is usually the access level, not the wiring.

## Finish the change

A new tool changes what a user can do with their mailbox, so it is not finished at the code boundary:

- The capability tables in [README.md](../../../README.md) list the tool surface for orientation. Add the tool there.
- If the tool is destructive, or needs a permission the current scope list does not request, it changes [Register an Azure application](../user/azure-app-registration.md) and [Configure the server](../user/configuration.md) as well — including the per-level tool counts.
- If the tool introduces a new failure a user can hit, it belongs in [Troubleshoot](../user/troubleshooting.md) with the message that identifies it.
- Record the change in [CHANGELOG.md](../../../CHANGELOG.md).
