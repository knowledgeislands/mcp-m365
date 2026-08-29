# Security Policy

## Reporting a Vulnerability

If you find a security issue in `@knowledgeislands/mcp-m365`, **please do not file a public GitHub issue.** Instead, email the maintainer directly:

- **<kris@kris.me.uk>** — subject: `mcp-m365 security`

Include:

- A description of the issue and the impact (e.g. "token exfil", "auth bypass").
- Steps to reproduce, ideally with a minimal proof-of-concept.
- The version of the package (`npm ls @knowledgeislands/mcp-m365`) and Node version.

You should expect an acknowledgement within 72 hours. We aim to triage, investigate, and ship a fix within 14 days for high-severity issues.

## Scope

In scope:

- Authentication and token handling (`src/auth-server/`, `src/tools/auth/`, `src/main/auth/`).
- The Microsoft Graph HTTP client (`src/main/graph-client/`) and the tools that call it (`src/tools/calendar/`, `src/tools/email/`, `src/tools/folder/`, `src/tools/onedrive/`, `src/tools/rules/`).
- HTML sanitization in `src/utils/html-sanitizer.ts` (used to render email bodies).

Out of scope:

- Issues only reproducible against a forked or modified version.
- Vulnerabilities in upstream Microsoft Graph endpoints (please report those to Microsoft via [MSRC](https://www.microsoft.com/en-us/msrc)).
- Issues that require local OS-level access already higher-privileged than the user running the MCP server.

## Token Storage

OAuth tokens are stored at `~/.local/state/ki/mcp-m365/oauth-tokens.json` with `0600` permissions (owner read/write only). Tokens are refreshed transparently; if you suspect your tokens have leaked, **delete that file immediately** and re-authenticate.

You can also revoke the app's access from <https://myaccount.microsoft.com/apps>.

## Supported Versions

Only the latest published `1.x` release receives security fixes. Older pre-release builds are not supported.

| Version | Supported          |
| ------- | ------------------ |
| 1.x     | :white_check_mark: |
| < 1.0   | :x:                |
