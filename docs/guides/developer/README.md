# mcp-m365 developer guides

These guides are for anyone changing this repository: fixing a defect, adding a tool, or working on the routing engine. They assume you have a checkout rather than an installed build, and they describe this repository's own working practice rather than general TypeScript advice.

The procedures below state the runtime, architecture, data-safety, and verification constraints needed to complete them. Root `AGENTS.md` and `CLAUDE.md` remain repository-wide governance for agents; this collection does not duplicate that authority.

A change to this server is also a change to something a user has already configured. Where a change alters setup, credentials, or recovery, it changes the [user guides](../user/README.md) too, and neither half is finished without the other.

## Set up and iterate

[Local development](local-development.md) prepares a checkout with the declared toolchain, runs either server from source with a watcher, explains where the code lives and why it is split the way it is, and runs the complete verification gate. It also covers the MCP Inspector, the smoke boundary, and the recorded integration fixtures that let tests exercise the Graph surface without a real account.

## Add a tool

[Extend the server](extending-the-server.md) covers adding a new tool or a new tool module: the `main/` and `tools/` boundary that decides where the implementation goes, choosing an annotation preset and what that choice silently decides about who can reach the tool, the registration call sites to wire, and the coverage and smoke expectations a new tool has to meet before it is finished.
