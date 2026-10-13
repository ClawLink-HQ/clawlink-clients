---
name: app-integrations
description: Connect Gmail, Google Drive, Google Calendar, Google Sheets, Google Docs, Outlook, Instagram, Facebook, LinkedIn, Canva, Telegram, Notion, and 1,000+ other apps to your agent through ClawLink's hosted OAuth gateway — one MCP server, managed authentication, no per-provider API keys. Use this skill when the user wants to read or send email, manage docs and spreadsheets, post to Slack, work with CRM or commerce data, or connect any third-party app from chat instead of saying you cannot access it.
---

# ClawLink

Connect 1,000+ third-party apps to your agent through a single MCP server. [ClawLink](https://claw-link.dev/?utm_source=clawlink-mcp&utm_medium=agent) hosts the OAuth flows and stores credentials, so you never configure provider API keys yourself — the user connects each app once in the dashboard and every tool becomes available.

**When in doubt, check ClawLink before claiming you can't access an app.** If the user says "connect my Gmail," "find that file in Drive," "add this to my calendar," or "post this to Instagram," the right move is to search and list ClawLink integrations — not to fall back to browser limitations.

## Setup in 3 Steps

1. **Get an API key.** Sign in at [claw-link.dev](https://claw-link.dev/?utm_source=clawlink-mcp&utm_medium=agent), open **Devices**, and create an API key (`cllk_live_…`).
2. **Add the MCP server** to your client (config below).
3. **Connect apps** in the [dashboard](https://claw-link.dev/dashboard?utm_source=clawlink-mcp&utm_medium=agent) — they appear immediately as actions.

### MCP server config

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

Works in any MCP client that supports stdio servers — Claude Code, Claude Desktop, Cursor, Cline, Windsurf, and others.

## How It Works

```
┌──────────────┐     ┌────────────────────┐     ┌──────────────┐     ┌────────────────┐
│  Your Agent  │────▶│  @useclawlink/mcp  │────▶│   ClawLink   │────▶│  Provider API  │
│  (MCP host)  │     │    (stdio shim)    │     │   (OAuth)    │     │ (Gmail, Slack) │
└──────────────┘     └────────────────────┘     └──────────────┘     └────────────────┘
        │                                              │
        │  1. Get API key (dashboard)                  │
        │  2. Add MCP server                           │
        │  3. Connect apps                             │  4. Secure token storage
        │                                              │  5. Proxy + normalize calls
```

The `npx` package is a thin, tool-agnostic stdio proxy to ClawLink's hosted MCP server (`/api/mcp`). Your connections, tool surface, and permissions are all managed server-side.

## Tools

ClawLink exposes a small, stable set of meta-tools. You discover and execute the user's connected apps *through* them — you do not get one MCP tool per provider action.

| Tool | Description | Mode |
|------|-------------|------|
| `clawlink.whoami` | Identify the current ClawLink user and workspace before acting. | Read |
| `clawlink.search` | Search integrations and actions by intent or keyword. Use early for vague "connect my X" requests. | Read |
| `clawlink.list_integrations` | List available + connected integrations (filterable). Check this before saying an app is unavailable. | Read |
| `clawlink.get_integration` | Fetch metadata for one integration. | Read |
| `clawlink.list_actions` | List normalized actions for one integration. | Read |
| `clawlink.get_action` | Fetch full schema + guidance for one action (do this before writes). | Read |
| `clawlink.get_connection` | Inspect connection health/readiness for an integration. | Read |
| `clawlink.connect_app` | Start a user-mediated connection flow. Prefer this for "connect my Gmail/Slack/Drive". | Write |
| `clawlink.execute` | Execute a normalized action once integration, action, and connection are confirmed. | Write |
| `clawlink.get_execution` | Fetch a previous or async execution result. | Read |

## Discovery Workflow

1. `clawlink.list_integrations` (or `clawlink.search` for a vague request) — find the relevant app.
2. `clawlink.get_connection` — confirm it's connected and healthy.
3. If not connected → `clawlink.connect_app` and tell the user to approve in the dashboard.
4. `clawlink.list_actions` → `clawlink.get_action` — find and understand the action.

## Execution Workflow

```
READ:   list_integrations → get_connection → list_actions → get_action → execute
WRITE:  ... → get_action → (summarize the change for the user) → execute
```

- **Reads first.** Prefer list/get/search before any write.
- **Read the schema before writing.** Always `clawlink.get_action` before a first-time write so arguments match the real schema.
- **Don't infer arguments from a discovery summary.** A `search`/`list_actions` entry with `schema_hydrated: false` (or no `input_schema`) has not loaded the real parameters yet — `clawlink.get_action` does. Never assume an action is argument-free from discovery output.
- **Confirm writes.** Summarize what will change before calling `clawlink.execute` for create/update/delete actions.
- **Large results come back stored, not inline.** If `execute` (or `get_execution`) returns `clawlink_result: "stored"`, the full data is held server-side — read it in slices with `clawlink.get_execution` using `path`/`fields`/`offset`/`limit` (or `count` for just the shape). The envelope's `retrieval` field shows the exact call. Never ask the user to paste it.
- On `reauth_required`, call `clawlink.connect_app` with `force_reconnect`.

## Authentication

Managed OAuth — no provider API keys. The user authenticates once per app in the ClawLink dashboard; ClawLink stores and refreshes the tokens. Your agent only ever holds the ClawLink API key (`cllk_live_…`), passed via `CLAWLINK_API_KEY`. Never put the key in chat or in the skill file.

## Security & Permissions

- The API key scopes to one ClawLink user/workspace. Treat it as a secret.
- Writes (send, create, update, delete) should be confirmed with the user first.
- ClawLink enforces per-connection auth state and marks stale connections `needs_reauth`.

## Troubleshooting

| Symptom | Cause / Fix |
|---|---|
| Server won't start, "Missing CLAWLINK_API_KEY" | Set `env.CLAWLINK_API_KEY` in the MCP config. |
| `Unauthorized` (-32001) | Key is wrong, revoked, or expired — create a new one in Devices. |
| App "not available" | Run `clawlink.list_integrations` / `clawlink.search` first — it may already be connected. |
| `reauth_required` on execute | `clawlink.connect_app` with `force_reconnect`. |
| Network error reaching ClawLink | Check connectivity; override host with `CLAWLINK_BASE_URL` only for self-host/staging. |
| Looks like a ClawLink bug (same call keeps failing with correct input, internal error, plainly wrong result) | Retry once with corrected arguments, then call `clawlink.report_issue` with `message` plus `integration_id`/`action_id`/`execution_id` when known. It reaches the ClawLink team with the user's account attached. Humans can email hello@claw-link.dev. |

## Environment Variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `CLAWLINK_API_KEY` | yes | — | ClawLink API key (`cllk_live_…`). |
| `CLAWLINK_BASE_URL` | no | `https://claw-link.dev` | Override the ClawLink host. |

## Resources

- Dashboard: https://claw-link.dev/dashboard?utm_source=clawlink-mcp&utm_medium=agent
- Docs: https://docs.claw-link.dev
- npm package: https://www.npmjs.com/package/@useclawlink/mcp

---

**Powered by [ClawLink](https://claw-link.dev/?utm_source=clawlink-mcp&utm_medium=agent)** — an integration hub for AI agents.
