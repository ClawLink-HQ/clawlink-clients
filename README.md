# ClawLink clients

The code that runs on your machine when you use [ClawLink](https://claw-link.dev).
This repository is a published copy of the agent clients, so you can read exactly
what they do before you install them.

| Folder | Package | Used by |
| --- | --- | --- |
| [`openclaw-clawlink`](openclaw-clawlink) | [`@useclawlink/openclaw-plugin`](https://www.npmjs.com/package/@useclawlink/openclaw-plugin) (also on ClawHub as `clawlink-plugin`) | OpenClaw |
| [`clawlink-cli`](clawlink-cli) | [`@useclawlink/cli`](https://www.npmjs.com/package/@useclawlink/cli) | Any agent with a shell |
| [`clawlink-mcp`](clawlink-mcp) | [`@useclawlink/mcp`](https://www.npmjs.com/package/@useclawlink/mcp) | Claude Desktop, Cursor and other MCP clients |

The Hermes plugin lives in its own repository: [ClawLink-HQ/hermes-plugin](https://github.com/ClawLink-HQ/hermes-plugin).

## What these clients do

- They talk to one host: `https://claw-link.dev`. You can point them elsewhere
  with `CLAWLINK_BASE_URL`; nothing else is contacted.
- They hold one secret: your ClawLink API key (`cllk_live_…`). The CLI and the
  MCP shim save it to a local file readable only by your user (`chmod 600`);
  OpenClaw keeps it in its own plugin config.
- They never see your Gmail, Slack or other app passwords or OAuth tokens.
  You approve access on the provider's own sign-in screen, and those tokens are
  held server-side by our OAuth provider, not on your machine and not in chat.
- Writes, deletes and sends are refused by the server unless the request is
  confirmed.

How the server side handles your data: <https://claw-link.dev/security>.

## Reporting a security issue

Email security@claw-link.dev with reproduction steps. Please do not open a
public issue for a vulnerability.

## About this repository

It is updated from ClawLink's private monorepo when a client is released, so
pull requests can't be merged here directly. Open an issue instead and we'll
make the change upstream.

Licenses: the OpenClaw plugin is AGPL-3.0; the CLI and MCP shim are MIT. Each
folder carries its own `LICENSE`.
