# mcp-m365 user guides

These guides are for anyone running `mcp-m365` against their own Microsoft 365 account. The server runs on your machine as a subprocess of your MCP client, talks only to Microsoft Graph, and stores its OAuth tokens in a single file under your home directory. No part of this is hosted, shared, or multi-user: the person who runs the server is the person whose mailbox it reads.

Read [Register an Azure application](azure-app-registration.md), [Install and connect the server](installation.md), and [Sign in](authentication.md) in that order the first time. They form one route from nothing to a working connection, and each names what the next one assumes. After that, come back to whichever guide matches the task in front of you.

Two things are worth knowing before you start. The server registers only read-only tools until you widen `MCP_M365_ACCESS_LEVEL`, so a fresh installation cannot send, move, or delete anything. And the destructive tools it can register act on a real mailbox, so read [Configure the server](configuration.md) before raising that level rather than after.

## Register an application with Microsoft

[Register an Azure application](azure-app-registration.md) covers the one-time work in the Azure portal: creating the app registration, choosing an account type that matches the mailbox you intend to use, registering the redirect URI the server's sign-in flow depends on, granting the delegated Microsoft Graph permissions and what each one buys you, and creating the client secret. It ends with the two values you carry into the next guide, and with the failures the portal produces when one of those choices is wrong.

## Install the server and connect a client

[Install and connect the server](installation.md) takes you from a checkout to a client that can call the server: the runtimes it needs, building the distributable entry point, writing the MCP client configuration block, and starting the OAuth callback server. It ends with the two tool calls that prove the connection works before you trust it with anything.

## Sign in and stay signed in

[Sign in](authentication.md) explains the out-of-band OAuth flow the server uses, why a separate callback server exists, where the tokens land and with what permissions, how silent refresh keeps a session alive, and how to force re-authentication, change the scopes you consented to, or revoke the application's access to your account entirely.

## Choose what the server may do

[Configure the server](configuration.md) is the reference-shaped guide behind the other four: every environment variable the server reads, what the access-level gate registers at each of its three settings, how the audit log records tool invocations, where state files land and how to move them, and the precedence rules that decide which `.env` file wins. Read the access level and audit sections before you widen the server's reach.

## Route mail with the deterministic engine

[Route mail with the routing engine](email-routing.md) covers the triage engine: the filesystem roots that bound everything it touches, writing and linting a rule file in the line DSL, the report-then-live discipline that keeps a first run harmless, the resumable batch loop the run tools expect callers to drive, saving attachments out of a message, and reconciling the tracking cache when you re-file mail by hand.

## Recover from a failure

[Troubleshoot](troubleshooting.md) collects the failures a first-time reader actually hits — a refused client secret, a redirect-URI mismatch, a tenant that rejects `/common`, a tool that is missing rather than broken, a port already in use, a routing path outside its roots — each with the message that identifies it and the command or setting that recovers from it.
