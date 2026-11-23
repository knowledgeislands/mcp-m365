# mcp-m365 guides

`mcp-m365` is an MCP server that gives an AI client access to one Microsoft 365 account — Outlook mail, calendar, mail folders and inbox rules, plus OneDrive files — through the Microsoft Graph API. These guides explain how to register it with Microsoft, run it against your own account, and change its code.

`docs/decisions/` record why this repository is arranged the way it is, and `docs/roadmap/` record what is planned rather than delivered. A guide never restates either; it names them and explains how to act.

Start with the audience you belong to.

## Running the server against your own account

[User guides](user/README.md) are for anyone who wants this server connected to their own Microsoft 365 mailbox, calendar, and OneDrive. They cover registering an Azure application and granting it the permissions the server needs, installing the server and connecting an MCP client to it, signing in and keeping the sign-in alive, choosing how much of the tool surface to expose, driving the deterministic email routing engine, and recovering when any of that fails. Nothing in them requires you to read TypeScript.

## Changing the server

[Developer guides](developer/README.md) are for anyone changing this repository: fixing a defect, adding a tool, or working on the routing engine. They cover preparing a checkout and running the complete verification gate, and adding a new tool module without breaking the access gate or the configuration-injection rule. The procedures themselves carry the constraints needed to complete them.

Root `AGENTS.md` and `CLAUDE.md` remain the repository-wide governance for agents; this collection does not duplicate that authority.

## What is not here

**There is no tool inventory guide.** The list of tools answers _what the server exposes_ rather than _how to do something with it_, and the authoritative version of that list is executable: any MCP client can call `tools/list` and see exactly what this build registered at the access level you configured, and `m365_about` reports the server's own identity. A hand-maintained copy here would be a second inventory with nothing holding it to the first, and a guide that is confidently wrong about a tool name is worse than one that never claimed to list them. The root `README.md` keeps a capability catalogue so that a reader can decide whether this server does what they need; treat it as orientation and `tools/list` as truth.

**There is no release guide.** This repository has no documented release procedure to write down. That gap is recorded rather than filled.
