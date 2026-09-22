# mcp-m365

[![CI](https://github.com/knowledgeislands/mcp-m365/actions/workflows/ci.yml/badge.svg)](https://github.com/knowledgeislands/mcp-m365/actions/workflows/ci.yml) [![npm version](https://img.shields.io/npm/v/@knowledgeislands/mcp-m365.svg)](https://www.npmjs.com/package/@knowledgeislands/mcp-m365) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

An MCP (Model Context Protocol) server that connects Claude with Microsoft 365 services — Outlook (email, calendar, folders, rules) and OneDrive (files, search, sharing) — through the Microsoft Graph API.

It runs on your machine as a subprocess of your MCP client, talks only to Microsoft Graph, and acts as you: every permission is delegated, so it can never reach anything you could not reach yourself. By default it registers only its read-only tools.

## Getting started

Setting this up takes three steps, in this order, and each has its own guide:

1. **[Register an Azure application](docs/guides/user/azure-app-registration.md)** — the one-time work in Microsoft's console that produces a client ID and secret.
2. **[Install and connect the server](docs/guides/user/installation.md)** — build it and point your MCP client at it.
3. **[Sign in](docs/guides/user/authentication.md)** — authorise the server against your account.

[All guides](docs/guides/README.md) covers the rest: what every setting does, driving the email routing engine, recovering from failures, and changing the code.

## Features

- **OAuth 2.0** — a standalone auth server handles the user consent flow; tokens are cached locally and refreshed transparently.
- **Outlook coverage** — read/search/send/delete email, manage folders + rules, create/accept/decline/cancel calendar events.
- **OneDrive coverage** — list/search/download/upload (with chunked >4 MB upload), create folders, share files.
- **Deterministic email routing** — a first-match-wins rule engine in a small line DSL, with report-then-live runs and filesystem access bounded to directories you allowlist.
- **Access-level gate** — tools are registered according to an ordinal `read` / `write` / `destructive` setting derived from each tool's own MCP annotations, so a tool below the configured level is never offered to the client at all.
- **Strict input schemas** — every tool registers a Zod schema with `.strict()`, so `tools/list` reports proper JSON Schema and tool annotations.
- **Modular structure** — the implementation lives in `src/main/<concern>/` (email, calendar, folder, rules, OneDrive, triage); `src/tools/<service>/index.ts` is a thin registration shell that validates args and maps the result to an MCP envelope.

**Quality:** 100% line / branch / function / statement coverage on the `main/` + `utils/` logic, with all destructive paths covered (the wiring-only `mcp-server` / `tools/**/index.ts` / `auth-server` and pure-data modules are coverage-excluded).

## Available Tools

The tables below are a capability catalogue, so that you can see whether this server does what you need. They are maintained by hand and the authoritative list is executable: call `tools/list` from any MCP client to see exactly what your build registered at your configured access level.

Tool results follow the standard MCP shape (`{ content: [{ type: 'text', text: '…' }] }`) and carry honest annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`). Of the 36 tools, 12 derive `read`, a further 16 derive `write`, and the remaining 8 derive `destructive` — see [Configure the server](docs/guides/user/configuration.md) for what each level registers.

### Auth & meta

| Tool               | Description                                                                              |
| ------------------ | ---------------------------------------------------------------------------------------- |
| `m365_about`       | Returns information about this MCP M365 server.                                          |
| `m365_auth_start`  | Initiate the OAuth flow and persist tokens to disk (registered at the `write` level).    |
| `m365_auth_status` | Check authentication status — presence + scope/expiry metadata only, never token values. |

### Outlook (Email & Calendar)

| Tool                           | Description                                                             |
| ------------------------------ | ----------------------------------------------------------------------- |
| `m365_email_messages_list`     | List recent emails from inbox, folder path, or explicit folder ID.      |
| `m365_email_messages_search`   | Search emails by query and/or date range. †                             |
| `m365_email_message_get`       | Read email content.                                                     |
| `m365_email_message_send`      | Send a new email.                                                       |
| `m365_email_draft_create`      | Save an email draft.                                                    |
| `m365_email_message_mark_read` | Mark email as read/unread.                                              |
| `m365_email_message_delete`    | Move an email to Deleted Items (or hard delete with `permanent: true`). |
| `m365_calendar_events_list`    | List calendar events.                                                   |
| `m365_calendar_event_create`   | Create calendar event.                                                  |
| `m365_calendar_event_accept`   | Accept event invitation.                                                |
| `m365_calendar_event_decline`  | Decline event invitation.                                               |
| `m365_calendar_event_cancel`   | Cancel a calendar event.                                                |
| `m365_calendar_event_delete`   | Delete calendar event.                                                  |
| `m365_email_folders_list`      | List mail folders.                                                      |
| `m365_email_folder_create`     | Create mail folder.                                                     |
| `m365_email_folder_rename`     | Rename an existing mail folder.                                         |
| `m365_email_folder_delete`     | Delete a mail folder.                                                   |
| `m365_email_messages_move`     | Move emails between folders.                                            |
| `m365_email_rules_list`        | List inbox rules.                                                       |
| `m365_email_rule_create`       | Create inbox rule.                                                      |
| `m365_email_rules_reorder`     | Change the execution order of an existing inbox rule.                   |

† Searches by `query` and/or date range (`receivedAfter`/`receivedBefore`), in inbox, folder path, or explicit folder ID.

`m365_email_messages_list` and `m365_email_messages_search` accept either a `folder` — a well-known name such as `inbox`, or a full custom path such as `Projects/2026/Q2` — or an explicit `folderId` returned by `m365_email_folders_list`. When both are given, `folderId` wins and is used directly.

```json
{
  "name": "m365_email_messages_search",
  "arguments": {
    "folderId": "AAMkAGVmMDEz...",
    "query": "invoice",
    "unreadOnly": true,
    "receivedAfter": "2026-01-01T00:00:00Z",
    "count": 50
  }
}
```

### Email routing engine

A deterministic triage engine: a flat, ordered, first-match-wins rule list in a small line DSL, executed mechanically rather than interpreted. The server holds no rule state — your rule file stays the single source of truth, read fresh on each call. Distinct from `m365_email_rule_*` above, which manage Outlook's own server-side inbox rules.

Everything the engine touches on disk must resolve inside `MCP_M365_TRIAGE_ROOTS`, or the call is refused. Both run tools default to `mode: "report"` and mutate nothing until you pass `mode: "live"`; both are batch-bounded and resumable, acting on at most `maxActions` messages per call and reporting `remaining`. A rule may also lift PDF attachments out of a message into a destination the rule file declares, bounded separately by `MCP_M365_ATTACHMENT_ROOTS`.

[Route mail with the routing engine](docs/guides/user/email-routing.md) covers the rule DSL, the destinations block, the run loop, and recovery.

| Tool | Purpose |
| --- | --- |
| `m365_email_routing_triage` | Classify Inbox mail against the `inbound` rule block and apply the first matching rule's actions. |
| `m365_email_routing_aged` | Apply the `aged` retention block across the `_TRIAGE` subfolders. |
| `m365_email_routing_lint` | Static checks over a rule file — parse errors, unreachable rules, duplicates, broad-rule collisions, unknown move targets. No mailbox access. |
| `m365_email_routing_drift` | Report messages the user has re-routed by hand and prune the tracking cache. Returns the diff; writes no suggestions. |

The three run tools are annotated `DESTRUCTIVE_ONESHOT_REMOTE` — destructive and explicitly _not_ idempotent, because repeating a call advances to the next batch rather than converging on the same end state.

### OneDrive

| Tool                              | Description                |
| --------------------------------- | -------------------------- |
| `m365_onedrive_items_list`        | List files in a path.      |
| `m365_onedrive_items_search`      | Search files by query.     |
| `m365_onedrive_item_download`     | Get download URL.          |
| `m365_onedrive_item_upload`       | Upload small file (<4 MB). |
| `m365_onedrive_item_upload_large` | Chunked upload (>4 MB).    |
| `m365_onedrive_item_share`        | Create sharing link.       |
| `m365_onedrive_folder_create`     | Create folder.             |
| `m365_onedrive_item_delete`       | Delete file or folder.     |

## Example Conversations

Concrete asks you might make of Claude with this server connected.

**Triage by sender and date range:**

> "Find unread emails from `finance@acme.com` received after 2026-04-01 and read the most recent one."

Claude calls [`m365_email_messages_search`](#outlook-email--calendar) with `query: "finance@acme.com"`, `unreadOnly: true`, `receivedAfter: "2026-04-01T00:00:00Z"`, then `m365_email_message_get` on the top result. Both honour mail-folder scoping (`folder` name or explicit `folderId`).

**Draft a reply to a meeting:**

> "Find Alice's invite for tomorrow's planning sync and draft a reply confirming I'll be there."

Claude uses `m365_email_messages_search` + `m365_email_message_get` to locate the invite, then [`m365_email_draft_create`](#outlook-email--calendar) to save the response in your Drafts folder. (Sending an email goes through `m365_email_message_send` — the server exposes both; calendar invites can be accepted directly via [`m365_calendar_event_accept`](#outlook-email--calendar).)

**Upload a file to OneDrive:**

> "Upload `~/Documents/Q2-report.pdf` to OneDrive under `Projects/2026/Q2`. The folder doesn't exist yet — create it."

Claude calls [`m365_onedrive_folder_create`](#onedrive) for the missing path, then [`m365_onedrive_item_upload`](#onedrive) for the file (or [`m365_onedrive_item_upload_large`](#onedrive) if it's over 4 MB; the chunked upload handles arbitrary sizes).

**Review the week's calendar:**

> "Show me my calendar for next week and accept the marketing review invite if it's still open."

Claude calls [`m365_calendar_events_list`](#outlook-email--calendar) with the appropriate date range, finds the marketing review by subject, and runs [`m365_calendar_event_accept`](#outlook-email--calendar) to send the acceptance.

## Security Model

- Secrets (`MCP_M365_CLIENT_SECRET`) come from env vars only; never committed. `.env*` files are gitignored except `.env*.example` templates.
- OAuth tokens live in `~/.local/state/ki/mcp-m365/oauth-tokens.json` (mode 0600 when written). The MCP server reads, refreshes, and rewrites this file but never logs token values.
- The auth server binds to `localhost:3333` only and accepts a single OAuth callback at a time; pending CSRF state entries expire after 10 minutes.
- Tool annotations honestly mark destructive operations (`m365_email_message_delete`, `m365_calendar_event_delete`, `m365_email_folder_delete`, `m365_onedrive_item_delete`, etc.) so MCP clients can prompt before invoking them — and the same annotations drive the access-level gate, so an unannotated tool fails safe to `destructive` and is not registered by default.
- Every path the routing engine touches, configured or caller-supplied, is checked lexically and then through `realpath` against the configured roots, so neither `..` traversal nor a symlink out of a root gets through.
- Every Graph API call goes through [`src/main/graph-client/index.ts`](./src/main/graph-client/index.ts), which centralises retries and 401 → token-refresh handling.

Report a vulnerability via [SECURITY.md](./SECURITY.md) rather than a public issue.

## Contributing

[Developer guides](docs/guides/developer/README.md) cover preparing a checkout, the verification gate, and adding a tool. [CONTRIBUTING.md](./CONTRIBUTING.md) covers the contribution process, and [AGENTS.md](./AGENTS.md) states the working conventions in their shortest form.
