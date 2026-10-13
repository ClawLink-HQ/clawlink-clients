# @useclawlink/mcp

Connect **Gmail, Google Drive, Calendar, Sheets, Docs, Outlook, Instagram, LinkedIn, Canva and 1,000+ other apps** to any MCP-capable agent through [ClawLink](https://claw-link.dev/?utm_source=npm&utm_medium=referral&utm_content=mcp)'s hosted OAuth gateway.

This package is a tiny stdio shim. ClawLink already runs a full MCP server over HTTP; this forwards your client's stdio JSON-RPC to it with your credential. No app passwords, no per-provider OAuth setup, no Google Cloud project — connect each app once and every tool becomes available to your agent.

## Setup

**Fastest path** — two commands, nothing pasted anywhere:

```bash
npx -y @useclawlink/cli login                 # browser approval, stores a credential
npx -y @useclawlink/cli install claude-code   # or: cursor / windsurf / claude-desktop
```

The shim reads the credential `login` stores at `~/.clawlink/credentials.json`, so the client config it writes contains no API key.

**Manual path** — works in any stdio MCP client (Claude Code, Claude Desktop, Cursor, Cline, Windsurf, and others). If you've run `login`, the `env` block is optional; otherwise create a key (`cllk_live_...`) at [claw-link.dev](https://claw-link.dev/?utm_source=npm&utm_medium=referral&utm_content=mcp) under **Devices** and include it:

```json
{
  "mcpServers": {
    "clawlink": {
      "command": "npx",
      "args": ["-y", "@useclawlink/mcp"],
      "env": { "CLAWLINK_API_KEY": "cllk_live_your_key_here" }
    }
  }
}
```

Config file locations: Cursor `~/.cursor/mcp.json` (or `.cursor/mcp.json` per project), Windsurf `~/.codeium/windsurf/mcp_config.json`, Claude Desktop `claude_desktop_config.json` in the app's config directory, Claude Code via `claude mcp add --transport stdio clawlink -- npx -y @useclawlink/mcp`.

**Connect your apps.** In the [dashboard](https://claw-link.dev/dashboard?utm_source=npm&utm_medium=referral&utm_content=mcp) (or via `npx -y @useclawlink/cli connect <app>`), connect the providers you want. They appear as tools in your agent on its next session.

## How it works

```
Your agent (stdio) ──▶ @useclawlink/mcp ──▶ https://claw-link.dev/api/mcp ──▶ Provider API
```

The shim is transparent and tool-agnostic: it forwards JSON-RPC messages and writes responses back. Your tool surface, connections, and permissions are all managed server-side by ClawLink. Provider OAuth tokens stay server-side, encrypted at rest; they are never written to your machine and never enter the agent's context.

Credential resolution order: `CLAWLINK_API_KEY` env var, then `~/.clawlink/credentials.json` (written by `clawlink login`). The stored `baseUrl` travels with the stored key.

## Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `CLAWLINK_API_KEY` | no, if `clawlink login` has run | — | Your ClawLink API key (`cllk_live_...`); overrides the stored credential |
| `CLAWLINK_BASE_URL` | no | `https://claw-link.dev` | Override the ClawLink host (self-host / staging) |

## Links

- Dashboard: https://claw-link.dev/dashboard?utm_source=npm&utm_medium=referral&utm_content=mcp
- Guide for any agent: https://claw-link.dev/learn/connect-apps-to-any-ai-agent
- Docs: https://docs.claw-link.dev

MIT © ClawLink
