# Register an Azure application

Use this guide once, before installing the server. Microsoft will not issue tokens for an account until an application has been registered to ask for them, so this registration is what turns `mcp-m365` from a program on your disk into something your mailbox will talk to.

The work happens entirely in Microsoft's console, not in this repository. It produces two values — a client ID and a client secret — and one setting, the redirect URI, that has to match the server's configuration exactly. Getting the redirect URI wrong is the single most common reason a first sign-in fails, and it fails at the Microsoft sign-in page rather than anywhere you can see from here.

## Before you begin

You need an account that is allowed to register applications in the directory you intend to use. A personal Microsoft account can always register one. A work or school account often cannot: many tenants restrict application registration to administrators, and some additionally require an administrator to consent to the permissions afterwards. If you are using a work mailbox and the portal refuses, that is a policy decision by whoever runs your tenant, and the fix is a conversation rather than a setting.

Decide now which mailbox this server will read. The account type you choose during registration determines which accounts can sign in, and changing it later means the tokens you already hold stop working.

You do not need the server installed yet, and you do not need anything built. Keep a scratch note open: this guide produces two values you will paste into [Install and connect the server](installation.md).

## Create the app registration

1. Open the [Azure Portal](https://portal.azure.com/).
2. Search for "App registrations".
3. Click "New registration".
4. Name it something you will recognise later, for example "MCP M365 Server". The name is shown on the consent screen you will see when you sign in, and nowhere else that matters.
5. Choose the account type. "Accounts in any organizational directory and personal Microsoft accounts" is the broadest and works for both a personal Outlook account and a work mailbox. Choose a single-tenant option only if you know you want to restrict sign-in to one directory — and if you do, note the tenant ID, because you will have to set `MCP_M365_TENANT_ID` explicitly.
6. Set the redirect URI: platform "Web", value `http://localhost:3333/auth/callback`.
7. Click "Register".
8. Copy the "Application (client) ID" from the overview page. This is `MCP_M365_CLIENT_ID`.

The redirect URI is where Microsoft sends the browser back after you approve the sign-in, and the server's own callback listener has to be at that exact address. `3333` is the server's default port. If something else on your machine already owns that port, you may use a different one, but then the port has to change in three places at once: this registration, `MCP_M365_REDIRECT_URI`, and `MCP_M365_AUTH_PORT`. Changing it in fewer than three produces a sign-in that appears to work until the redirect, and then does not.

Use `http`, not `https`, and `localhost`, not `127.0.0.1`. Microsoft treats `localhost` redirect URIs as a special case that does not require TLS; the numeric form is a different string and will not match.

## Grant the Graph permissions

1. Go to "API permissions" under Manage.
2. Click "Add a permission" → "Microsoft Graph" → "Delegated permissions".
3. Add these permissions:
   - `offline_access`
   - `User.Read`
   - `Mail.Read`, `Mail.ReadWrite`, `Mail.Send`
   - `Calendars.Read`, `Calendars.ReadWrite`
   - `Files.Read`, `Files.ReadWrite`
4. Click "Add permissions".

These are _delegated_ permissions, meaning the server acts as you and can never reach anything you could not reach yourself. That is the whole security posture of this registration: there are no application permissions here, so the registration grants no standing access to anyone's data, only the ability to ask you for yours.

What each one buys:

| Permission | Why the server needs it |
| --- | --- |
| `offline_access` | Issues a refresh token. Without it, every sign-in expires within the hour and cannot be renewed silently. This is not optional. |
| `User.Read` | Reads your own profile, which is how the server resolves whose mailbox it is talking to. |
| `Mail.Read` | Lists, searches, and reads messages and mail folders. |
| `Mail.ReadWrite` | Creates drafts, marks messages read, moves messages between folders, creates and deletes folders, and manages inbox rules. |
| `Mail.Send` | Sends a message. Separate from `Mail.ReadWrite` in Graph, and separately consented. |
| `Calendars.Read` | Lists calendar events. |
| `Calendars.ReadWrite` | Creates, accepts, declines, cancels, and deletes events. |
| `Files.Read` | Lists, searches, and downloads OneDrive items. |
| `Files.ReadWrite` | Uploads, creates folders, creates sharing links, and deletes items. |

You can grant fewer than this. The consequence is not a smaller tool list — the server registers tools according to `MCP_M365_ACCESS_LEVEL`, not according to what you consented to — but a tool that exists, is offered to the client, and fails at call time with a Graph authorisation error. If you want a smaller surface, the tool to reach for is the access level in [Configure the server](configuration.md), not a shorter permission list. If you do want a shorter list anyway, set `MCP_M365_SCOPES` to match it exactly: the scopes requested at consent time and at refresh time come from the same list, and a mismatch between what you consented to and what the server asks for produces silent failures on individual APIs rather than an obvious error.

If your tenant requires administrator consent, the "Grant admin consent" button on this page is what an administrator uses. Without it, sign-in stops with a message saying approval is needed, and no token is issued.

## Create the client secret

1. Go to "Certificates & secrets" → "Client secrets".
2. Click "New client secret".
3. Add a description and select an expiration.
4. Copy the **Value** column, not the **Secret ID** column. This is `MCP_M365_CLIENT_SECRET`.

The value is shown once. Leave the page without copying it and there is no way to retrieve it; delete the secret and make another. The Secret ID sitting next to it is a harmless identifier that looks equally plausible and is the wrong thing — a secret ID in `MCP_M365_CLIENT_SECRET` is the origin of the `AADSTS7000215: Invalid client secret` failure in [Troubleshoot](troubleshooting.md).

Note the expiry date somewhere you will see it again. Microsoft does not warn you, and an expired secret fails in exactly the same way an incorrect one does.

Treat this value as a password. It belongs in `.env.development`, which this repository gitignores, or in your MCP client's `env` block — never in a file you commit and never in a chat window.

## What you should have now

- **Application (client) ID** — a GUID, becomes `MCP_M365_CLIENT_ID`.
- **Client secret value** — an opaque string, becomes `MCP_M365_CLIENT_SECRET`.
- **Directory (tenant) ID** — only if you registered a single-tenant application, becomes `MCP_M365_TENANT_ID`.

Continue with [Install and connect the server](installation.md). Nothing is verifiable until the server can attempt a sign-in, so the first real test of this registration is the first browser sign-in at the end of [Sign in](authentication.md).

## Rotate an expiring secret

A client secret expires on the date you chose, and the server gives no notice. To replace one without losing your session, create the new secret before the old one lapses, update `MCP_M365_CLIENT_SECRET` wherever you set it, restart the MCP server so it reloads its configuration, and only then delete the old secret in the portal.

Rotating the secret does not invalidate your existing tokens, so a working session survives the change. It does invalidate the next silent refresh if the new value has not reached the server's environment, which is the failure mode to watch for: everything works until the access token expires, and then nothing does.

## Recover from a registration failure

- **The portal will not let you register an application.** Your tenant restricts registration to administrators. There is no workaround from this side.
- **`AADSTS50011` or a redirect-URI mismatch at sign-in.** The URI registered in step 6 differs from the one the server sent. Compare them character by character, including scheme, `localhost` versus `127.0.0.1`, port, and the `/auth/callback` path.
- **`AADSTS7000215: Invalid client secret`.** The Secret ID was copied instead of the Value, or the secret has expired. Create a new secret and copy the Value column.
- **`AADSTS700016` or an application-not-found error.** The client ID is wrong, or the application is registered in a different directory from the one the sign-in is being attempted against. Check `MCP_M365_CLIENT_ID`, then check whether the registration is single-tenant and needs `MCP_M365_TENANT_ID` set.
- **Sign-in says approval is required.** Your tenant requires administrator consent for these delegated permissions. An administrator has to grant it on the "API permissions" page.
- **A tool fails with a Graph authorisation error even though sign-in worked.** A permission is missing from the registration, or was added after you consented. Add it, then force a fresh consent as described in [Sign in](authentication.md) — a refresh token issued under the old scope set does not gain the new one on its own.
