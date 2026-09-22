# Sign in

Use this guide to authorise the server against your Microsoft 365 account, and whenever that authorisation needs renewing, widening, or revoking. It assumes the server is installed and reachable from your client, as verified at the end of [Install and connect the server](installation.md).

Sign-in is out-of-band: the MCP server never sees your password and never handles the browser redirect. It hands you a URL, you approve the request in your own browser, and Microsoft sends the result to a separate small server listening on `localhost`. That separation is why there are two processes, and it is also why a failed sign-in never takes the MCP server down with it.

## Sign in for the first time

1. Start the OAuth callback server if it is not already running:

   ```bash
   bun run ki:server:auth:dev
   ```

   It listens on `http://localhost:3333`, which must match the redirect URI registered in Azure.

2. Open <http://localhost:3333/auth> in your browser. The callback server generates the request and redirects you to Microsoft.

3. Sign in as the account whose mailbox you want the server to reach, and approve the requested permissions. The consent screen names the application you registered and lists the scopes it is asking for.

4. Microsoft redirects back to the callback server, which completes the exchange and writes the tokens to `~/.local/state/ki/mcp-m365/oauth-tokens.json` with `0600` permissions — owner read and write only.

5. Call `m365_auth_status` from your MCP client to confirm. It reports presence, scopes, and expiry, and never the token values themselves.

The callback server accepts a single OAuth callback at a time, and a pending request expires after ten minutes. If you leave the sign-in page open and come back to it much later, start again from `/auth` rather than reloading; the state it was carrying is gone. Each flow carries a fresh single-use state and a PKCE verifier, so a reused or stale callback is rejected rather than honoured.

Once tokens are on disk you can stop the callback server. It is needed only during a sign-in.

### Signing in from the client instead

`m365_auth_start` does the same thing from inside your MCP client, returning the sign-in URL as a tool result. It is not available at the default access level: because it persists tokens to disk it is annotated as a write, so it is registered only at `MCP_M365_ACCESS_LEVEL=write` or above. `m365_auth_status`, which only reads metadata, is available at every level.

That is why the browser route above is the one this guide leads with. It works no matter how the server is configured, and it means a first sign-in does not require widening the tool surface before you have confirmed anything works. If your access level is already `write` or `destructive`, use whichever you prefer — they drive the same flow through the same callback server.

## How the session stays alive

The consent includes `offline_access`, so Microsoft issues a refresh token alongside the access token. The MCP server reads the token file, notices when an access token has expired, exchanges the refresh token for a new one, and rewrites the file — all without involving you and without the callback server running. Every Graph call goes through one HTTP client that centralises this, so a 401 becomes a refresh and a retry rather than an error you see.

This is why `offline_access` is not optional. Without it, the session lasts about an hour and then every tool fails until you sign in again by hand.

Tokens are never logged and never returned by a tool. `m365_auth_status` deliberately reports metadata only.

## Force a fresh sign-in

Delete the token file and start again:

```bash
rm ~/.local/state/ki/mcp-m365/oauth-tokens.json
```

Then repeat the browser flow with the callback server running. If `m365_auth_start` is registered at your access level, it also accepts `force: true`, which re-runs the flow without you deleting anything first.

Do this when:

- **You changed the permissions on the Azure registration.** A refresh token carries the scopes it was issued with. Adding a permission in the portal does not widen an existing session, and the symptom is a tool that worked yesterday failing with a Graph authorisation error on a newly added capability.
- **You changed `MCP_M365_SCOPES`.** Same reason: the consent-time and refresh-time scope lists come from the same source, and a session issued under the old list stays on the old list.
- **You want to sign in as a different account.** There is one token file and one session; switching accounts means replacing it.
- **You suspect the tokens have leaked.** Delete the file, then revoke at Microsoft's end as well — see below. A local delete stops this machine using the tokens; it does not stop anyone else who has a copy.

## Move the token file

`MCP_M365_TOKEN_PATH` sets an explicit location. Otherwise the path derives from `XDG_STATE_HOME`, which defaults to `$HOME/.local/state`, giving `~/.local/state/ki/mcp-m365/oauth-tokens.json`. `XDG_STATE_HOME` must be absolute when you set it.

Moving the file does not migrate it. Set the new path, then sign in again, or move the existing file yourself and keep its `0600` mode.

## Revoke the application's access

Deleting the local token file ends this installation's session. To withdraw the application's access to your account entirely, revoke it at Microsoft: <https://myaccount.microsoft.com/apps>.

Revoking there invalidates the refresh token, so the next silent refresh fails and every tool starts reporting that authentication is required. That is the correct behaviour and the signal that the revocation took effect. Signing in again re-consents from scratch.

## Recover from a failed sign-in

- **`Authentication required. Please use the 'm365_auth_start' tool first.`** — there are no usable tokens. Either you have not signed in, the token file was deleted, or a refresh failed. Run the sign-in flow again. If `m365_auth_start` is not in your client's tool list, that is the access level, not a fault: use the browser route.
- **`m365_auth_start` is not offered by the client at all.** It derives the `write` level. Raise `MCP_M365_ACCESS_LEVEL` and restart the server, or sign in through <http://localhost:3333/auth> instead.
- **The browser never reaches the callback.** The callback server is not running, or it is not on the port in the redirect URI. Start it, and check `MCP_M365_AUTH_PORT` against the URI registered in Azure.
- **<http://localhost:3333/auth> returns a configuration error.** The callback server has no client ID or client secret in its environment. It reads the same variables the MCP server does, so check `.env.development` or the environment you started it from.
- **The redirect fails at Microsoft rather than at `localhost`.** The registered redirect URI and the one the server sent differ. See the recovery list in [Register an Azure application](azure-app-registration.md).
- **`AADSTS7000215: Invalid client secret`.** The secret value is wrong or expired — not the sign-in. Fix it in the environment and restart the MCP server so the new configuration is loaded.
- **Sign-in succeeds but a specific tool reports an authorisation failure.** The scope for that capability was never consented to. Add the permission in the portal, then force a fresh sign-in; the existing refresh token will not pick it up.
- **`Port 3333 in use`.** Something else owns the port. Free it or move the server — and if you move it, change the port in the Azure redirect URI, `MCP_M365_REDIRECT_URI`, and `MCP_M365_AUTH_PORT` together. [Troubleshoot](troubleshooting.md) has the commands.
