---
name: clawlink-runtime
description: Use ClawLink when the user asks you to read from or act in Gmail, Slack, Notion, Google Docs, Sheets, calendars, CRMs, inboxes, or another external app they have connected to ClawLink.
---

## About ClawLink

ClawLink is a third-party integration hub for OpenClaw. It is not affiliated with or endorsed by the OpenClaw project; it is an independent SaaS that stores provider OAuth tokens and API credentials on ClawLink servers, encrypted at rest, so OpenClaw can call external apps without per-provider setup.

Verifiable identity:
- ClawHub package: `clawlink-plugin` (preferred install)
- npm package: `@useclawlink/openclaw-plugin` (https://www.npmjs.com/package/@useclawlink/openclaw-plugin)
- Source code: the published package is the source. Run `npm pack @useclawlink/openclaw-plugin` and read `package/index.js` (plain, unminified JavaScript). Verification page: https://claw-link.dev/verify
- Website: https://claw-link.dev/?utm_source=openclaw-plugin&utm_medium=agent&utm_content=npm
- Docs: https://docs.claw-link.dev/openclaw
- License: AGPL-3.0

Security posture:
- ClawLink stores provider OAuth tokens and API keys on ClawLink servers, encrypted at rest, after the user authorizes an integration.
- Stored provider credentials are used only to execute user-triggered integration requests and maintain those connections.
- npm releases are published from GitHub Actions with npm provenance.
- ClawHub verification includes source-linked release metadata for the published artifact.
- The runtime only calls `https://claw-link.dev` over HTTPS using the locally stored ClawLink device credential.

The plugin only talks to `claw-link.dev` over HTTPS using a locally stored ClawLink device credential. Browser pairing mints that device credential, and OpenClaw stores it locally after the user returns from the browser and sends `done`. Provider tokens and API keys are not written to OpenClaw config or shown to the assistant.

## Install

Install ClawLink from ClawHub, OpenClaw's plugin registry, when the user asks for it. Prefer ClawHub over npm.

```bash
openclaw plugins install clawhub:clawlink-plugin
```

The install enables the plugin and applies to the running Gateway, so do not restart the Gateway. If `openclaw plugins list` shows `clawlink-plugin` as disabled, run `openclaw plugins enable clawlink-plugin`. The ClawLink tools become available on your next turn, not in the turn where you ran the install. So do not call them in that turn: they fail with `Unknown tool id`. End the turn and tell the user: "ClawLink is installed. Reply ok and I will give you your pairing link." On the next turn, call `clawlink_begin_pairing` (see "Not configured yet"). An `Unknown tool id` error right after install is not a broken Gateway: do not restart it.

If you cannot end your turn (for example you are inside a long task or a loop that waits for messages), call the tools through the Gateway instead, from the shell. This runs the installed plugin in the same turn:

```bash
openclaw gateway call tools.invoke --json --timeout 300000 --params '{"name":"clawlink_begin_pairing","args":{}}'
openclaw gateway call tools.invoke --json --timeout 300000 --params '{"name":"clawlink_get_pairing_status","args":{}}'
```

Run the first for the pairing link, and the second after the user approves. The plugin stores the credential itself.

## When to use this skill

Use this skill when the user asks you to read from or act in an external app or service, such as Notion, Gmail, Outlook, ClickUp, Google Calendar, Apollo, or OneDrive. Use it only for that request. Do not call ClawLink for requests that do not involve an external app.

When the app is connected to ClawLink, use the ClawLink tools below instead of browser workarounds, and do not ask the user for separate per-app credentials.

## After pairing

After pairing, you can call `clawlink_list_integrations` once to show the user which apps are connected. Suggest other apps only when the user asks what they can connect, and send them to the dashboard to connect them.

## Discovery workflow (start here)

1. Call `clawlink_list_integrations` to identify connected app slugs.
2. If the user named an app, call `clawlink_list_tools` with that exact integration slug. Do not call it without `integration`.
3. If the user described a capability but the exact tool is unclear, call `clawlink_search_tools` with a short query and, when known, the integration slug.
4. Treat the returned tool list or search result as the source of truth for the current turn. Do not rely on memory, prior examples, or assumptions about what a provider can do.
5. If the user names or hints at a specific ClawLink tool, verify it against `clawlink_describe_tool`, or app-scoped `clawlink_list_tools` / `clawlink_search_tools`, instead of contradicting the user from memory.
6. If a matching tool exists, proceed to the execution workflow.
7. If no matching tool exists, call `clawlink_list_integrations` to check whether the app is connected but has no tools, or is not connected at all.
8. If the app is not connected, switch to the connection workflow below.

## Capability claims

Before saying any of the following, you must have checked the live ClawLink tool catalog in the current turn:

- "there is no tool for that"
- "ClawLink does not support that"
- any provider-specific claim about missing capabilities

If you have not called `clawlink_list_integrations` and then either app-scoped `clawlink_list_tools` or `clawlink_search_tools` in the current turn, do not make those claims. Check the live catalog first.

## Execution workflow

1. If the user asked for a concrete operation and there is an exact matching tool in the catalog, prefer using that exact tool name over substituting a nearby search tool.
2. Call `clawlink_describe_tool` before using an unfamiliar tool, before any write, or any time the request is ambiguous.
3. Use the returned `whenToUse`, `askBefore`, `safeDefaults`, `examples`, and `followups` guidance to shape the request.
4. Prefer read, list, search, and get operations before writes whenever that reduces ambiguity.
5. For writes or anything marked as requiring confirmation, call `clawlink_preview_tool` first.
6. Call `clawlink_call_tool` with the selected tool name and arguments. Pass confirmation only after previewing or after the user clearly confirms the action.
7. If the user has multiple connections for one integration, use the default unless the user asked for a specific account. Pass `connectionId` when needed.
8. If the tool call fails, report the actual error. Do not invent results, and do not restate the failure as a capability gap unless the live tool catalog supports that conclusion.
9. If a result comes back marked `"clawlink_result": "stored"`, it is a large result held server-side, not the full data. Do not paste it or ask the user to. Read only the part you need with `clawlink_get_result`, passing the `execution_id` and selectors: `path` (dot path into the data, e.g. `"messages"`), `fields` (only these keys per item), `offset`/`limit` (paginate an array), or `count` (just the shape/size).
10. Summarize the result clearly and offer a sensible next step.

## Connecting a new app

If the user wants to use an app they have not connected yet, the connection happens in the ClawLink dashboard, in their browser, with no commands for the user.

1. Tell the user, in plain language, to open https://claw-link.dev/dashboard?utm_source=openclaw-plugin&utm_content=npm in their browser and connect the app there.
2. Wait for the user to confirm they finished. When they do, call `clawlink_list_integrations` to confirm the new connection appeared, then continue with the discovery workflow using `clawlink_list_tools` for the connected integration slug.
3. Do not call `clawlink_start_connection` or `clawlink_get_connection_status` for this — the dashboard is the user-facing connection surface.

## Not configured yet

If a ClawLink tool reports that the plugin is not configured, the plugin has not been paired with the user's ClawLink account yet. Handle it like this:

1. Install the plugin first with the command in the Install section if needed.
2. Preferred path: call `clawlink_begin_pairing`. Tell the user to open the returned pairing URL, sign in to ClawLink if needed, and approve the device in the browser.
3. Tell the user to come back to OpenClaw and send `done` after approval completes.
4. When the user comes back, call `clawlink_get_pairing_status` to finish storing the local credential and verify the result.
5. If the ClawLink tools are not visible after install, follow "Tool visibility issues".

Never do the pairing exchange yourself with `curl` or by editing `openclaw.json`: your shell output masks secrets, so a hand-written key is saved as `***` and breaks the plugin. Only the plugin tools finish pairing.

## Tool visibility issues

If the ClawLink plugin is installed and enabled but the ClawLink tools do not appear:

1. The active tool profile can hide plugin tools. For example, the `coding` profile shows plugin tools only when `tools.alsoAllow` lists them. The `full` profile shows them with no change.
2. This is a config change for the OpenClaw owner. Do not change the config yourself. Tell the user: "Your OpenClaw tool profile hides plugin tools. In the Control UI (or `~/.openclaw/openclaw.json`), add `clawlink-plugin` to `tools.alsoAllow`, then ask me for the pairing link again."
3. On OpenClaw versions before 2.0, the tool list can load only in a new chat. Tell the user to send `/new` as a standalone message and ask for ClawLink again.
4. Do not use `group:plugins` unless the user or admin explicitly wants all plugin tools enabled; prefer the narrow `clawlink-plugin` allow entry.
5. If this does not help, report it to ClawLink (see "Reporting a ClawLink problem").

## Reporting a ClawLink problem

When something looks like a ClawLink fault rather than a mistake in your arguments — the same tool keeps failing with correct input, a connected app reports an internal error, results are plainly wrong — report it instead of leaving the user stuck.

1. Retry once with corrected arguments first, using the `inputSchema` and `missingFields` from the error payload. Most failures are argument problems and are not worth reporting.
2. If it still fails, call `clawlink_call_tool` with tool name `CLAWLINK_REPORT_ISSUE` and arguments `{ "message": "<what you were doing and the exact error text>", "integration": "<slug>", "action": "<tool name that failed>", "executionId": "<execution id if you have one>" }`. Only `message` is required.
3. Tell the user you reported it, and that they can also email hello@claw-link.dev directly.
4. Do not report the same problem more than once per conversation, and never report an argument-validation error you have not tried to fix.

Reports go to the ClawLink team with the user's account attached. Never put the user's ClawLink credential, provider tokens, or API keys in the report.

## Rules

- When the user asks you to act in an external app, check the ClawLink tools for that app.
- The live output of app-scoped `clawlink_list_tools` and `clawlink_search_tools` overrides your prior beliefs about which provider operations exist.
- Prefer tool-driven browser pairing with `clawlink_begin_pairing`, then use `clawlink_get_pairing_status` after the user returns from the browser and says `done`.
- If the tools are not visible after install, follow "Tool visibility issues". Never restart the Gateway or change OpenClaw config yourself.
- For apps connected to ClawLink, do not ask for separate per-app credentials.
- Do not hardcode provider-specific behavior when `clawlink_describe_tool` can provide guidance.
- If a user mentions a specific ClawLink tool name, verify it against app-scoped `clawlink_list_tools`, `clawlink_search_tools`, or `clawlink_describe_tool` instead of dismissing it from memory.
- Ask for confirmation before destructive actions and before broad or ambiguous writes.
- If the user request is vague, use a read or search tool first when possible.
- If no relevant integration is connected, direct the user to https://claw-link.dev/dashboard?utm_source=openclaw-plugin&utm_content=npm instead of pretending the tool is available.
- Never print, echo, or repeat the user's ClawLink credential.
