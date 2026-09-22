# Troubleshoot

Use this guide when the server will not start, will not sign in, or will not do something you expected it to do. The failures below are grouped by where they surface, because that is usually the fastest way to identify which of the four moving parts — the client, the MCP server, the callback server, or Microsoft — is actually at fault.

One distinction is worth holding on to throughout. A tool that is **missing** from the client's list is almost always a configuration decision, most often the access level. A tool that is **present and fails** is almost always a credential, consent, or connectivity problem. They look similar from a conversation and have nothing in common underneath.

## The server does not start

**The client offers none of the `m365_*` tools.** The server was never launched, or it exited immediately.

- Confirm `dist/mcp-server/index.js` exists. If it does not, run `bun run build`.
- Confirm the path in the client's `args` is absolute and correct. The client launches the server from its own working directory, so a relative path will not resolve.
- Confirm Node 22 or newer is what `command` resolves to.
- Restart the client. Most MCP clients read their configuration once at startup.

**`Cannot find module`.** Dependencies are not installed:

```bash
bun install
```

**The server exits with `Invalid MCP_M365_ACCESS_LEVEL=…`.** The value is not one of `read`, `write`, or `destructive`. An unrecognised value aborts startup deliberately rather than falling back to a default, so that a typo cannot silently widen or narrow the surface.

**The server exits with `Invalid MCP_M365_AUDIT_LOG=…`.** Same shape of failure. Allowed values are `off`, `writes`, and `all`.

## The sign-in fails

**`Authentication required. Please use the 'm365_auth_start' tool first.`** There are no usable tokens — you have not signed in, the token file was deleted, or a refresh failed. Run the flow in [Sign in](authentication.md). The message names a tool that is not registered at the default access level; the browser route at <http://localhost:3333/auth> is the one to use, and it works at every level.

**`Port 3333 in use`.** Something else owns the callback port:

```bash
bunx kill-port 3333
bun run ki:server:auth:dev
```

If you would rather move the server, remember the port appears in three places that must agree: the redirect URI registered in Azure, `MCP_M365_REDIRECT_URI`, and `MCP_M365_AUTH_PORT`.

**`AADSTS7000215: Invalid client secret`.** Use the secret **Value** from "Certificates & secrets", not the Secret ID. If you are certain the value is right, check the expiry date — an expired secret fails identically to a wrong one. [Register an Azure application](azure-app-registration.md) covers rotation.

**A redirect-URI mismatch at the Microsoft sign-in page.** The registered URI and the one the server sent differ. Compare them character by character: scheme, `localhost` versus `127.0.0.1`, port, and the `/auth/callback` path all have to match exactly.

**An error naming `/common` or an invalid tenant.** The registration is single-tenant and the sign-in is going to the multi-tenant endpoint. Set `MCP_M365_TENANT_ID` to your directory's tenant ID.

**The sign-in page says approval is required.** Your tenant requires administrator consent for these delegated permissions. Only an administrator can grant it, on the registration's "API permissions" page.

**The browser opens but nothing ever completes.** The callback server is not running, or is not on the port in the redirect URI. Start it and retry from <http://localhost:3333/auth>. A pending sign-in expires after ten minutes, so an abandoned attempt has to be restarted rather than reloaded.

## A tool is missing

**A tool you expect is not offered at all.** Check `MCP_M365_ACCESS_LEVEL`. The default is `read`, which registers 12 tools; `write` registers 28; `destructive` registers all 36. A tool below the configured level is never registered, so it cannot appear. The table in [Configure the server](configuration.md) says which tools each level adds.

**`m365_auth_start` is missing on a fresh installation.** That is the same cause and it is expected: the tool persists tokens, so it derives `write` and is absent at the default level. Sign in through <http://localhost:3333/auth> instead of raising the level to get at it.

**All the routing tools are missing except `m365_email_routing_lint`.** The three run tools are destructive and need `MCP_M365_ACCESS_LEVEL=destructive`. The lint tool is read-only, which is why it survives at every level.

**You changed the access level and nothing changed.** Configuration is read once at startup. Restart the MCP server, which usually means restarting the client that launches it.

## A tool is present and fails

**A Graph authorisation error on one capability, while other tools work.** The scope for that capability was never consented to. Add the permission to the Azure registration, then force a fresh sign-in — a refresh token carries the scopes it was issued with and will not pick up a new one on its own.

**Everything worked until an hour ago and now nothing does.** Silent refresh has stopped working. The usual causes are a rotated client secret that has not reached the server's environment, a revoked application at <https://myaccount.microsoft.com/apps>, or a consent granted without `offline_access`, in which case there was never a refresh token to use. Delete `~/.local/state/ki/mcp-m365/oauth-tokens.json` and sign in again.

**Tokens work in one process and not the other.** `MCP_M365_CLIENT_ID` or `MCP_M365_CLIENT_SECRET` differ between your MCP client's `env` block and `.env.development`. A variable already in the environment beats every `.env` file, so the two processes can legitimately be using different credentials without either being obviously wrong.

**A change to `.env.development` has no effect under your MCP client.** The `.env.${NODE_ENV}` file is loaded only when `NODE_ENV` is set, and MCP clients generally do not set it. Put the variable in the client's `env` block, or in `.env.local`, which is loaded in every mode.

## The routing engine refuses

**`Refusing to access the … : no roots are configured.`** `MCP_M365_TRIAGE_ROOTS` is unset, which disables all engine file access. Set it and restart.

**`… it resolves outside the configured roots (…)`.** The path is real but outside the allowlist, or is a symlink that leaves it. Both are refused deliberately.

**A live run stops before the folder is empty.** That is the batch bound, not a failure: a call acts on at most `maxActions` messages and reports `remaining`. Loop while `remaining` is true and `acted` is above zero.

**Mail is filed to the wrong folder.** The rule list is first-match-wins, so a broader rule earlier in the file matched first. Run `m365_email_routing_lint`, which reports unreachable rules and broad-rule collisions, and reorder rather than adding a narrower rule underneath.

More routing-specific recovery is in [Route mail with the routing engine](email-routing.md).

## Still stuck

[Configure the server](configuration.md) documents every variable the server reads and what it defaults to, which is the fastest way to confirm what the running process actually believes. If the behaviour you are seeing contradicts what these guides describe, the guides are wrong and that is worth recording as a roadmap item rather than working around.
