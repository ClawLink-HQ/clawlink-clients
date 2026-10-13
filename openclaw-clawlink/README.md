# ClawLink OpenClaw Plugin

![ClawLink](https://claw-link.dev/images/logo/rounded-clawlink-small.png)

Connect 1,000+ apps (Gmail, Slack, GitHub, Calendar, Notion, and more) to OpenClaw via ClawLink.

One skill, 39,000+ tools, managed OAuth.

Use when the user asks to send emails, create issues, post messages, manage calendars, search documents, and more.

> **Not affiliated with OpenClaw.** ClawLink is an independent service. This package is published by the ClawLink team under the npm scope [`@useclawlink`](https://www.npmjs.com/package/@useclawlink/openclaw-plugin). The published tarball is the source: run `npm pack @useclawlink/openclaw-plugin` and read `package/index.js`, which is plain unminified JavaScript. License: AGPL-3.0.

### Setup in 3 Steps

| Step 1: Install | Step 2: Pair Account | Step 3: Connect Any App |
|:---:|:---:|:---:|
| ![Install](https://claw-link.dev/images/pairing/initialstep_1.gif) | ![Pair](https://claw-link.dev/images/approve_process.gif) | ![Connect](https://claw-link.dev/images/excel.gif) |
| Run the install command in OpenClaw | Sign in and approve the device | Open the dashboard and connect an app |

## How It Works

```
┌─────────────────┐     ┌──────────────┐     ┌──────────────────┐
│   OpenClaw      │────▶│   ClawLink   │────▶│ 1,000+ SaaS Apps │
│   (User Chat)   │     │   (OAuth)    │     │ (Gmail, Slack...)│
└─────────────────┘     └──────────────┘     └──────────────────┘
         │                       │                       │
         │  1. Install Plugin    │                       │
         │  2. Pair Device       │                       │
         │  3. Connect Any App   │                       │
         │                       │  4. Secure Token      │
         │                       │  5. Proxy Requests    │
         │                       │                       │
         ▼                       ▼                       ▼
   ┌──────────┐           ┌──────────┐           ┌──────────┐
   │  Plugin  │           │ Dashboard│           │ Provider │
   │  README  │           │ Auth     │           │  Data    │
   └──────────┘           └──────────┘           └──────────┘
```

## What it does

ClawLink stores provider OAuth tokens and API credentials on ClawLink servers, encrypted at rest, for a growing catalog of business apps on your behalf. It then exposes a uniform set of tools so OpenClaw can read from and write to those apps without per-provider setup. Today that includes integrations like Google Docs, Google Sheets, Google Calendar, Google Drive, Twilio, and Google Search Console. Setup is browser pairing: OpenClaw opens a ClawLink approval page, you approve the device once, then return to chat and send `done` so the plugin can store its local ClawLink device credential safely.

## Install

```bash
openclaw plugins install clawhub:clawlink-plugin
```

Or directly from npm:

```bash
openclaw plugins install @useclawlink/openclaw-plugin
```

## Configure

1. In OpenClaw, start browser pairing:
   - let the assistant call `clawlink_begin_pairing`
   - you do not need to restart the Gateway: the install applies to the running Gateway
   - if the tools are not visible, your tool profile may hide plugin tools: the OpenClaw owner adds `clawlink-plugin` to `tools.alsoAllow` (on OpenClaw before 2.0, start a new chat with `/new`)
   - if the tools still do not show, email hello@claw-link.dev
2. Open the returned ClawLink pairing URL in your browser and approve the device.
3. Go back to OpenClaw and send `done`.
4. Let the assistant call `clawlink_get_pairing_status` to finish storing the local credential.

The resulting device credential is stored locally in `~/.openclaw/openclaw.json` under `plugins.entries.clawlink-plugin.config.apiKey` and is only sent to `claw-link.dev`.

Full setup walkthrough: https://docs.claw-link.dev/openclaw

## Tools

The plugin registers eleven tools. OpenClaw's assistant discovers available integrations dynamically — you don't need to configure individual apps here.

- `clawlink_begin_pairing` — start or resume browser pairing for this OpenClaw install
- `clawlink_get_pairing_status` — finish pairing after the user returns from the browser and says `done`
- `clawlink_start_connection` — start a hosted OAuth/connect session for a new app
- `clawlink_get_connection_status` — poll an in-progress connect session
- `clawlink_list_integrations` — list apps already connected
- `clawlink_list_tools` — list callable tools for one connected app
- `clawlink_search_tools` — search connected tools by capability or keyword
- `clawlink_describe_tool` — fetch schema and usage guidance for one tool
- `clawlink_preview_tool` — preview a tool call before execution, especially for writes
- `clawlink_call_tool` — execute a tool against a connected app
- `clawlink_get_result` — read a large stored result in slices (path / fields / offset / limit / count)

## File Arguments

Some ClawLink tools accept file arguments shaped as `{ name, mimetype, s3key }`. When OpenClaw attaches a local file, the plugin reads files only from OpenClaw media directories, rejects path traversal and files over 25 MB, then sends the file bytes to ClawLink in the request's `files` envelope. ClawLink stages those file bytes with Composio before executing the provider tool, so local OpenClaw attachment paths are not forwarded directly to providers.

If a tool accepts a public URL alternative such as `image_url` or `video_url`, agents may use that instead of a local file attachment.

## Support Commands

Normal onboarding should happen through tools and browser pairing. These commands remain as support/debug escape hatches:

- `/clawlink pair [deviceLabel]` — start or resume browser pairing from the plugin fast path
- `/clawlink pair-status` — check whether browser pairing has been approved yet and finish setup after browser approval
- `/clawlink status` — show whether the plugin is paired
- `/clawlink logout` — remove the saved credential

## Security

- ClawHub package: `clawlink-plugin`
- npm package: `@useclawlink/openclaw-plugin`
- ClawHub releases carry source-linked release metadata, and ClawHub shows its own security audit and VirusTotal result on the listing.
- The published tarball is the source: `npm pack @useclawlink/openclaw-plugin` and read `package/index.js`.
- The plugin only makes outbound HTTPS requests to `https://claw-link.dev`.
- Browser pairing stores only a local ClawLink device credential under `~/.openclaw/openclaw.json`.
- Provider tokens and API keys are not written to OpenClaw config or shown to the assistant; they stay on ClawLink servers encrypted at rest.
- The local device credential is sent only as the `X-ClawLink-API-Key` header to ClawLink.
- Report security issues to security@claw-link.dev.

---

**Powered by [ClawLink](https://claw-link.dev/?utm_source=npm&utm_medium=referral&utm_content=openclaw-plugin)** — an integration hub for OpenClaw

![ClawLink Logo](https://claw-link.dev/images/logo/link_logo_black_small.png)
