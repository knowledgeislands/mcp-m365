# Install and connect the server

Use this guide to get `mcp-m365` running and reachable from an MCP client. It assumes you have already completed [Register an Azure application](azure-app-registration.md) and are holding a client ID and a client secret value; without those the server starts but every Graph call fails.

The end state is two processes and one configuration block. Your MCP client launches the server itself, as a subprocess speaking MCP over standard input and output — you never start it by hand. The OAuth callback server is the process you do start by hand, and only while signing in.

## Before you begin

- [Bun](https://bun.sh) 1.3 or newer, for installing dependencies and the development loop.
- Node.js 22 or newer, which is what runs the compiled `dist/` bundle your MCP client launches.
- The client ID and client secret from the Azure registration.
- An MCP client that launches a local server over stdio. Claude Desktop is the worked example below; any client with the same `command` and `args` shape works.

## Install dependencies and build

From the repository root:

```bash
bun install
bun run build
```

`bun run build` compiles `src/` to `dist/` with `tsc -p tsconfig.build.json` and is what produces `dist/mcp-server/index.js`. That path is what you put in the client configuration, so build before configuring rather than after: a client pointed at a file that does not exist fails at launch with a message about the file, which is easy to misread as a configuration error.

Note the absolute path of the checkout. You need it in the next step, and a relative path will not work — the client launches the server from its own working directory, not yours.

## Provide the credentials

The server reads its configuration from environment variables, and there are two places to put them. Which you choose depends on how you intend to run it:

- **In the MCP client's `env` block**, for a server your client launches. This is the normal case, and it is the one that always wins: a variable already present in the environment beats every `.env` file.
- **In `.env.development` at the repository root**, for running from source during development. Copy `.env.example` and fill it in. These files are gitignored; only the `.env*.example` templates are committed.

You can use both — the client block for the credentials and `.env.development` for the rest — as long as you keep `MCP_M365_CLIENT_ID` and `MCP_M365_CLIENT_SECRET` consistent between them. Two different client IDs in two places produces tokens that work in one process and not the other. The full variable list and the precedence rules are in [Configure the server](configuration.md).

## Configure the MCP client

Add a server entry naming the built entry point and your credentials:

```json
{
  "mcpServers": {
    "mcp-m365": {
      "command": "node",
      "args": ["/path/to/mcp-m365/dist/mcp-server/index.js"],
      "env": {
        "MCP_M365_CLIENT_ID": "your-client-id",
        "MCP_M365_CLIENT_SECRET": "your-client-secret"
      }
    }
  }
}
```

Replace `/path/to/mcp-m365` with the absolute path of your checkout. A starter file is in [`claude-config-sample.json`](../../../claude-config-sample.json).

Restart the client after editing its configuration. Most MCP clients read the file once at startup and will not notice an edit made while they are running.

By default the server registers only its read-only tools. That is deliberate and it is the right place to start: confirm the connection works before widening it. When you are ready to send, move, or delete anything, add `MCP_M365_ACCESS_LEVEL` to the same `env` block and read the access-level section of [Configure the server](configuration.md) first.

### Using the published package instead

The package publishes as `@knowledgeislands/mcp-m365` with two executables, `mcp-m365` for the MCP server and `mcp-m365-auth` for the OAuth callback server. If you install it rather than working from a checkout, point `command` at `mcp-m365` instead of at `node` and a `dist/` path, and drop `args`. Everything else in this guide — the credentials, the callback server, the sign-in — is identical.

## Start the OAuth callback server

The sign-in flow needs something listening on the redirect URI you registered with Azure. That is a separate process from the MCP server, and it exists so the two can run and fail independently:

```bash
bun run ki:server:auth:dev
```

This listens on `http://localhost:3333` and watches the source, which is what you want while setting up. To run the compiled build under Node instead, use `bun run ki:server:auth:start`, which builds first and then runs `dist/auth-server/index.js`.

You only need this process while authenticating. Once tokens are on disk, the MCP server refreshes them on its own and the callback server can stay stopped until you next need to sign in.

## Verify the installation

With the client restarted and the callback server running, make two calls from your client:

1. `m365_about` — returns this server's own identity. It reaches no Microsoft service, so a successful call proves the client launched the server and is speaking to it. A failure here is a path, runtime, or configuration problem, not an authentication one.
2. `m365_auth_status` — reports whether tokens are present, and their scopes and expiry. On a fresh installation it should tell you that you are not authenticated. That is the correct answer at this point, not a fault.

Both are read-only tools, so both are available at the default access level. `m365_auth_start` is not: it persists tokens to disk and therefore derives the `write` level. That is not an obstacle — the sign-in in the next guide runs through the browser and works at any access level — but it does mean a fresh installation shows twelve read tools and no way to authenticate from inside the client, which is easy to mistake for a broken install.

If both behave as described, the installation is sound and the only thing missing is a sign-in. Continue with [Sign in](authentication.md).

If `m365_about` is not offered by the client at all, the server did not start. Check the absolute path in `args`, confirm `dist/mcp-server/index.js` exists, and see [Troubleshoot](troubleshooting.md).

## Update or remove

To update, pull the repository and rebuild:

```bash
git pull
bun install
bun run build
```

Restart your MCP client afterwards so it relaunches the new build. Your credentials and tokens are untouched by a rebuild.

To remove the server, delete its entry from the MCP client configuration and restart the client. That stops it being launched, but leaves two things behind that you may also want to remove: the OAuth tokens at `~/.local/state/ki/mcp-m365/oauth-tokens.json` and the audit log beside them. Deleting the token file is also the right move if you simply want to end the session — see [Sign in](authentication.md) for revoking the application's access at Microsoft's end as well, which deleting a local file does not do.
