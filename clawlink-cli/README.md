# @useclawlink/cli

Connect **Gmail, Slack, Notion, Salesforce, HubSpot, Google Workspace and 230 other apps** to your AI agent through [ClawLink](https://claw-link.dev/?utm_source=npm&utm_medium=referral&utm_content=cli). Browser login, no API key to paste, no config to edit, no Google Cloud project.

## Quick start

```bash
npx -y @useclawlink/cli login          # sign in via browser — mints + stores a key
npx -y @useclawlink/cli connect gmail  # connect an app on the provider's own OAuth screen
npx -y @useclawlink/cli apps gmail     # search the 230 available apps
```

`login` opens a ClawLink page, you approve, and a credential is saved to `~/.clawlink/credentials.json`. You never register an OAuth app, configure a consent screen, or download a credentials file; ClawLink's provider apps are already registered, and the grant shows up in the provider's own third-party access list where you can revoke it.

## Set up your MCP client

```bash
npx -y @useclawlink/cli install claude-code
```

`install` writes the MCP config for the client you name, so the agent gets every connected app as tools:

| Client | What it does |
|---|---|
| `claude-code` | Runs `claude mcp add` for you (`--project` for project scope) |
| `cursor` | Writes `~/.cursor/mcp.json` (`--project` for `./.cursor/mcp.json`) |
| `windsurf` | Writes `~/.codeium/windsurf/mcp_config.json` |
| `claude-desktop` | Writes `claude_desktop_config.json` in the platform's config dir |

After `login`, no API key appears in any config file: the [@useclawlink/mcp](https://www.npmjs.com/package/@useclawlink/mcp) shim reads the stored credential itself. Any other stdio MCP client works with the generic JSON block `install` prints for unknown client names.

## Or: install the skill, no MCP config

```bash
npx -y @useclawlink/cli skill install
```

`skill install` writes a `skills/clawlink/SKILL.md` into every agent config folder that already exists on the machine (Claude Code, Cursor, Codex, Gemini CLI, Copilot, opencode, Windsurf, Roo, Continue, Qwen Code, Kilo, Goose). The skill teaches the agent to run this CLI, so no MCP server entry is needed. `skill remove` deletes exactly those files.

## Commands

| Command | Description |
|---|---|
| `clawlink login` | Sign in via browser (mints + stores an API key) |
| `clawlink install <client> [--project]` | Add ClawLink to an MCP client's config |
| `clawlink skill install` / `skill remove` | Write (or delete) the ClawLink skill in every agent config folder found on this machine |
| `clawlink logout` | Remove the local credential |
| `clawlink whoami` | Show the signed-in ClawLink account |
| `clawlink apps [query] [--connected] [--page N] [--limit N]` | List or search integrations. One page is not the whole catalog: the response carries `total`, and a `query` is the fast way to check whether an app is supported |
| `clawlink connect <app>` | Connect an app (opens browser OAuth), e.g. `gmail` |
| `clawlink connections <app>` | Show connection health. When the app is connected to more than one account, lists every connection with its id and label |
| `clawlink disconnect <app> [--connection <id>] [--confirm]` | Remove a connection and revoke its stored credentials. Without `--confirm` it previews what would be deleted; with several connections, `--connection` picks one |
| `clawlink actions <app> [intent]` | List actions for an app |
| `clawlink describe <app> <action>` | Show an action's schema (flags writes that need `--confirm`) |
| `clawlink run <app> <action> --input '<json>' [--connection <id>] [--confirm]` | Execute an action (`--confirm`/`-y` allows writes & deletes; `--connection` picks one of several connected accounts, omitted = the default) |
| `clawlink run clawlink report_issue --input '{"message":"..."}'` | Report a suspected ClawLink bug to the team. Optional `integration`, `action`, `executionId` fields. Humans can email hello@claw-link.dev |

JSON output is compact when stdout is piped or captured, and indented when you
run the command in a terminal. Compact output is about 24% smaller, which
matters when an agent reads it into its context. `--compact` and `--pretty`
force either mode.

### Confirming writes

Write, delete, and admin actions are gated server-side and refused unless you opt in — there's no interactive prompt on this surface. Pass `--confirm` (alias `-y` / `--yes`) so scripts and agents can proceed without dropping to raw `curl`:

```bash
clawlink run gmail send_email --input '{ ... }' --confirm
```

It's per-invocation by design: there is no persisted or environment default that auto-confirms every call, so an agent can only perform a write it explicitly asked for. Run `clawlink describe <app> <action>` first to see whether an action requires confirmation.

### Multiple accounts for one app

You can connect the same app more than once (two Instagram accounts, two Slack workspaces). Each connection has an id; calls without `--connection` use whichever one is marked default.

```bash
clawlink connections instagram
#   2 instagram connections:
#     1201  @mybrandshop  [default]
#     1305  @my.personal
clawlink run instagram get_user_info --input '{"ig_user_id":"me"}' --connection 1305
```

Provider note for Instagram: always query with `ig_user_id: "me"` and pick the account with `--connection`. One account's token can never read the other account by numeric id — Instagram rejects that with a misleading "does not exist / missing permissions" error.

## Environment

| Variable | Purpose |
|---|---|
| `CLAWLINK_API_KEY` | Use a key directly and skip `login` |
| `CLAWLINK_BASE_URL` | Override the ClawLink host (default `https://claw-link.dev`) |
| `CLAWLINK_NO_HARNESS` | Set to `1` to stop the CLI reporting which agent runs it (see below) |

The CLI tells ClawLink which agent launched it (`claude-code`, `codex`, `hermes-agent`, ...) by reading the marker each agent sets in its child processes, or the cross-agent `AI_AGENT` / `AGENT` variable. Only the name is sent, in the `User-Agent` header, and only for usage analytics. Set `AI_AGENT=false` or `CLAWLINK_NO_HARNESS=1` to opt out.
| `BROWSER` | Command used to open URLs; set `none` to never open one (headless machines just print the URL) |

## Links

- Dashboard: https://claw-link.dev/dashboard?utm_source=npm&utm_medium=referral&utm_content=cli
- Guide for any agent: https://claw-link.dev/learn/connect-apps-to-any-ai-agent
- Docs: https://docs.claw-link.dev

MIT © ClawLink
