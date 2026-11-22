# Configure the server

Use this guide when you need to change what the server may do, where it keeps its state, or which Microsoft cloud it talks to. Every setting is an environment variable; there is no configuration file of the server's own.

Two of these settings widen what an AI client can do to a real mailbox. Read [The access-level gate](#the-access-level-gate) before raising `MCP_M365_ACCESS_LEVEL`, and [The routing engine's filesystem roots](#the-routing-engines-filesystem-roots) before setting either roots variable.

## Where configuration comes from

The server reads `process.env`, once, at startup. Nothing is read at import time and there is no configuration singleton, so restarting the process is what applies a change — editing a variable while the server is running has no effect.

Before reading the environment, the server hydrates it from `.env` files found beside the package, in this precedence order, highest first:

1. `.env.local`
2. `.env.${NODE_ENV}`, when `NODE_ENV` is set
3. `.env`

**A variable already present in the environment always wins over every file.** That is the rule that matters in practice: your MCP client's `env` block beats anything in `.env.development`, and under a client that does not set `NODE_ENV` — Claude Desktop does not — `.env.development` is not loaded at all. The `ki:server:mcp:dev`, `ki:server:auth:dev`, and `ki:server:mcp:inspect` scripts set `NODE_ENV=development`, which is what makes `.env.development` the working file during local development.

`.env*` files are gitignored; only `.env*.example` templates are committed. [`.env.example`](../../../.env.example) is the template to copy.

## Credentials

| Name | Required | Default | Purpose |
| --- | --- | --- | --- |
| `MCP_M365_CLIENT_ID` | yes | — | Azure App Registration "Application (client) ID". |
| `MCP_M365_CLIENT_SECRET` | yes | — | The client secret **VALUE** from "Certificates & secrets", never the Secret ID. |
| `MCP_M365_TENANT_ID` | recommended | `common` | Directory (tenant) ID. Set it explicitly for a single-tenant registration, or the `/common` endpoint rejects the sign-in. |

Both credentials come from [Register an Azure application](azure-app-registration.md). Keep them consistent between `.env.development` and your MCP client's `env` block: two different client IDs in two places produce tokens that work in one process and not the other.

## Sign-in and token endpoints

| Name | Default | Purpose |
| --- | --- | --- |
| `MCP_M365_AUTHORITY_HOST` | `https://login.microsoftonline.com` | OAuth authority host. Override for sovereign clouds such as US Gov or China. |
| `MCP_M365_REDIRECT_URI` | `http://localhost:3333/auth/callback` | Where Microsoft returns the browser. Must match the URI registered in Azure exactly. |
| `MCP_M365_AUTH_PORT` | `3333` | Port the OAuth callback server listens on. Must match the port in the redirect URI. |
| `MCP_M365_TOKEN_ENDPOINT` | derived † | Full token endpoint URL. Override only for an authority with a non-standard path. |
| `MCP_M365_SCOPES` | the canonical list ‡ | Space-separated OAuth scopes requested for the access token. |

† `${MCP_M365_AUTHORITY_HOST}/${MCP_M365_TENANT_ID}/oauth2/v2.0/token`.

‡ `offline_access User.Read Mail.Read Mail.ReadWrite Mail.Send Calendars.Read Calendars.ReadWrite Files.Read Files.ReadWrite` — the `M365_DEFAULT_SCOPES` constant in [`src/config/index.ts`](../../../src/config/index.ts). It is a single source of truth deliberately: the consent flow and the refresh flow read the same list, and drift between them causes silent authorisation failures on individual APIs rather than an obvious error. `offline_access` is required to receive a refresh token.

Changing `MCP_M365_SCOPES` does not change an existing session. A refresh token carries the scopes it was issued with, so a scope change needs a fresh sign-in — see [Sign in](authentication.md).

The redirect URI, the auth port, and the URI registered in Azure are one setting spread across three places. Change all three together or none.

## State file locations

| Name | Default | Purpose |
| --- | --- | --- |
| `XDG_STATE_HOME` | `$HOME/.local/state` | Absolute base directory for the default token and audit paths. Must be absolute when set. |
| `MCP_M365_TOKEN_PATH` | `$XDG_STATE_HOME/ki/mcp-m365/oauth-tokens.json` | OAuth token file. Written with `0600` permissions. |
| `MCP_M365_AUDIT_LOG_PATH` | `$XDG_STATE_HOME/ki/mcp-m365/audit.jsonl` | Path to the JSONL audit log. |

Changing a path does not migrate the file that was at the old one. Move it yourself, preserving the token file's `0600` mode, or sign in again.

## The access-level gate

`MCP_M365_ACCESS_LEVEL` decides which tools are registered at all. A tool below the configured level is not merely refused when called — it is never offered to the client, so it cannot be invoked by accident or by a prompt injected into a message the client is reading.

| Level | Registers | Adds |
| --- | --- | --- |
| `read` (default) | 17 tools | Read-only tools: listing and searching mail, reading messages, mail changes and bounded file attachments, listing folders, rules, categories, the protected list, events and OneDrive items, linting a rule file, and the two meta tools. |
| `write` | 42 tools | 25 non-destructive mutations: sending and drafting mail, replying and forwarding, marking read, categorising and moving messages, creating folders, categories and rules, updating rules, creating and responding to events, uploading and sharing OneDrive files, and starting a sign-in. |
| `destructive` | 51 tools | 9 destructive tools: deleting a message, folder, rule, event or OneDrive item, cancelling an event, and the three routing-engine run tools. |

The levels nest, so `destructive` includes everything at `write`, which includes everything at `read`. An unrecognised value aborts startup rather than falling back to a default.

The level of each tool is derived from its MCP annotations rather than from its name: `readOnlyHint: true` derives `read`; `destructiveHint: true` derives `destructive`; an explicit `readOnlyHint: false` with `destructiveHint: false` derives `write`; and a tool with no annotations derives `destructive`, which is the fail-safe. A tool registers when its derived level is at or below the configured level.

Start at `read` and raise it deliberately. If a tool you expect is missing from the client's list, the access level is the first thing to check — see [Troubleshoot](troubleshooting.md).

## Protect folders and categories from change

`MCP_M365_PROTECTED_FILE` names a TOML file that lists folders and categories the server refuses to change, whoever calls it; a leading `~/` is expanded. Use one file per server entry, since each entry is one account, such as `~/.config/ki/mail-protected/hnr-mcp-m365.toml`:

```toml
version = 1
enforce = true

[[protected]]
kind = "folder"                      # held by folder id, so a rename does not lift it
id = "AAMkAGVmMDEz..."               # from m365_email_folders_list
name = "Legal"                       # for people; the id rules
subtree = true                       # default true: every folder beneath it too
reason = "Why, who and when"         # optional

[[protected]]
kind = "category"
id = "Legal hold"                    # a category is held by its name, compared case-insensitively
```

Take each folder id from `m365_email_folders_list`. The file is read afresh on every check, so an edit applies to the next call with no restart. `m365_email_protected_list` reports the file, whether it is enforced, and the folders each entry covers now.

While it is enforced, every tool that changes mail checks its targets before calling Graph and refuses with `PROTECTED_REFUSED` when any is protected: a message in a protected folder or carrying a protected category (read from Graph, not taken from the caller), moving mail into a protected folder, adding or removing a protected category, creating a folder beneath a protected one, renaming or deleting a protected folder, and creating, reordering, updating or deleting a rule that names one. A batch is refused whole, naming every refused target, and previews are refused as well. The routing engine's live passes check each message the same way and leave a refused one untouched; an unusable list refuses the whole live pass. Sending and drafting are not refused. There is no override: only editing the file lifts protection.

| State | `enforced` | Writes |
| --- | --- | --- |
| Variable unset, or no file at the path | `false` | Behave as before. |
| `enforce = false` | `false` | Behave as before. |
| File unreadable or invalid, or a folder id no longer resolves | `false`, with `error` | Every guarded write is refused with `PROTECTED_LIST_INVALID` until the file is fixed. |
| Valid file with `enforce = true` | `true` | Protected targets are refused. |

## The audit log

| Name | Default | Purpose |
| --- | --- | --- |
| `MCP_M365_AUDIT_LOG` | `writes` | Which invocations to record: `off`, `writes` (anything whose derived level is not `read`), or `all`. |
| `MCP_M365_AUDIT_LOG_MAX_BYTES` | `10485760` (10 MiB) | Size-based rotation threshold. `0` disables rotation. |
| `MCP_M365_AUDIT_LOG_KEEP` | `5` | Number of rotated files to retain. |

`off` short-circuits the wrapper entirely and never opens the file. The default records every mutation and no reads, which is usually what you want: it is the record of what was changed in your mailbox, without a line for every message anyone looked at.

## The routing engine's filesystem roots

These bound everything the email routing engine touches on disk. They are the reason a caller-supplied path is safe: the blast radius is the directories you allowlist and nothing else.

| Name | Default | Purpose |
| --- | --- | --- |
| `MCP_M365_TRIAGE_ROOTS` | — | `PATH`-style list of directories the engine may read and write. Unset disables all engine file access. |
| `MCP_M365_TRIAGE_RULES_PATH` | — | Default path to the rule note. When set, the routing tools' `rules` argument becomes optional. |
| `MCP_M365_TRIAGE_TRACKING_PATH` | `<first root>/.mcp-m365/email-triage/tracking.json5` | The engine's tracking cache. |
| `MCP_M365_ATTACHMENT_ROOTS` | — | `PATH`-style list of directories a `save-attachments:` action may write into. Unset disables attachment saving. |
| `MCP_M365_PDFTOTEXT_PATH` | `/opt/homebrew/bin/pdftotext` | The poppler `pdftotext` binary used to read a saved PDF's transaction total. |

Every path the engine touches, whether configured here or passed in a call, must resolve inside `MCP_M365_TRIAGE_ROOTS`, or the call is refused. The check is two-layer, lexical and then `realpath`, so neither a `..` traversal nor a symlink pointing out of a root gets through.

The two roots variables are deliberately separate so that neither widens the other: saving attachments has no business writing to the rule note, and the rule engine none writing into an attachment destination. Set only the one you need.

The tracking cache defaults beside the knowledge base it describes rather than into a hidden state directory, which is why its default is derived from the first root rather than from `XDG_STATE_HOME`. Add `.mcp-m365/` to that repository's `.gitignore`.

[Route mail with the routing engine](email-routing.md) covers what to do with these once they are set.

## Development conventions

`NODE_ENV` has no meaning to the server beyond selecting which `.env.${NODE_ENV}` file is loaded. The development scripts set it to `development`; production configuration comes from the host environment.
