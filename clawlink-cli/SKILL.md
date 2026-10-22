---
name: clawlink
description: Connect and use apps through ClawLink from the command line. Gmail, Slack, Notion, GitHub, HubSpot, Google Calendar and 1,000+ more, plus read-only public data: TikTok, Instagram, X, YouTube, LinkedIn, Reddit, Threads and other social platforms, SEO and AI-answer data, and crypto and stock prices. Use when the user asks to send, create, search, list or read something in one of their apps, or asks for public social, SEO or market data.
---

# ClawLink CLI

Every command is `npx -y @useclawlink/cli <command>`. Output is JSON, compact when
piped. Run `npx -y @useclawlink/cli <command> --help` for a command's flags.

## Flow

1. **Is the user signed in?** `whoami`. If not: `login` opens a browser page; the
   user approves there and a key is stored in `~/.clawlink/credentials.json`.
   Never ask the user for an API key.
2. **Is the app supported?** `apps <query>`, for example `apps hubspot`. The
   response carries `total`; one page is not the whole catalog.
3. **Is the app connected?** `connections <app>`. If not: `connect <app>` opens
   the provider's own sign-in page. Tell the user to approve it, then check
   `connections <app>` again.
4. **Find the action.** `actions <app> "<what the user wants>"` ranks matching
   actions first. `describe <app> <action>` prints the input schema and says
   whether the action needs `--confirm`.
5. **Run it.** `run <app> <action> --input '<json>'`. Add `--confirm` only for
   writes and deletes, and only after the user has asked for that exact change.

## Rules

- Reads first. Do not add `--confirm` to explore.
- One connection per app is the default. When `connections <app>` lists more
  than one, pass `--connection <id>` to `run`.
- A non-zero exit means the run was blocked or failed. Read `error.message` and
  `hint` in the output; the hint says what to change. Do not retry the same
  call unchanged.
- The data apps read public data and need no connect step: social
  (`tiktok-data`, `instagram-data`, `x-data`, `youtube-data`, `linkedin-data`,
  `reddit-data`, `threads-data` and more), shopping (`amazon-data`,
  `walmart-data`, `ebay-data`), music (`spotify-data`, `apple-music-data`),
  maps (`google-maps-data`, `apple-maps-data`), Google News/Shopping/Images/Scholar/Patents/Trends (`google-search-data`), jobs on Indeed, Glassdoor and remote boards (`jobs-data`), PDF and OCR (`pdf-data`), SEO (`seo-keyword-data`, `seo-domain-data`,
  `ai-visibility-data`) and markets (`crypto-market-data`, `stock-market-data`). Each call costs a few cents of ClawLink credit; the action's
  description shows the price. Do not loop over them without telling the user.
- To report a bug in ClawLink itself:
  `run clawlink report_issue --input '{"message":"..."}'`.

## Examples

```bash
npx -y @useclawlink/cli apps gmail
npx -y @useclawlink/cli actions gmail "send an email" --short
npx -y @useclawlink/cli describe gmail send_email
npx -y @useclawlink/cli run gmail send_email --input '{"to":"a@b.c","subject":"Hi","body":"Hello"}' --confirm
npx -y @useclawlink/cli run tiktok-data user_profile --input '{"uniqueId":"nasa"}'
```
