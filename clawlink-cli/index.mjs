#!/usr/bin/env node
/**
 * ClawLink CLI — browser-login + app actions for any AI agent.
 *
 * Friction-killer: `clawlink login` runs ClawLink's device-pairing flow
 * (browser approve → an API key is minted and stored locally), so users never
 * create or paste a key by hand and never edit an MCP config. The agent then
 * drives apps through `connect` / `apps` / `actions` / `run`, which call
 * ClawLink's hosted MCP endpoint with the stored key.
 *
 * Dependency-free (Node >=18). Credential stored at ~/.clawlink/credentials.json.
 */
import { homedir, platform } from "node:os";
import { join, dirname } from "node:path";
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, chmodSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const VERSION = "0.5.4";
const BASE_URL = (process.env.CLAWLINK_BASE_URL || "https://claw-link.dev").replace(/\/+$/, "");
const CONFIG_DIR = join(homedir(), ".clawlink");
const CONFIG_FILE = join(CONFIG_DIR, "credentials.json");
// Which agent harness is running this CLI, from the marker each one sets in its
// child processes. Order matters: the cross-agent AI_AGENT / AGENT convention
// first, then per-tool markers, IDE markers last so an agent inside an IDE wins.
// Only the NAME leaves the machine, never a value: some sibling variables
// (CLAUDE_CODE_MESSAGING_TOKEN, ...) are secrets. CLAWLINK_NO_HARNESS=1 opts out.
// Table follows unjs/std-env; the server stores the raw name for analytics only.
const HARNESS_MARKERS = [
  ["claude-code", ["CLAUDECODE", "CLAUDE_CODE"]],
  ["codex", ["CODEX_SANDBOX", "CODEX_THREAD_ID", "CODEX_CI"]],
  ["gemini-cli", ["GEMINI_CLI"]],
  ["openclaw", ["OPENCLAW_SHELL"]],
  ["hermes-agent", ["HERMES_AGENT"]],
  ["pi", ["PI_CODING_AGENT"]],
  ["opencode", ["OPENCODE"]],
  ["cline", ["CLINE_ACTIVE"]],
  ["replit", ["REPL_ID"]],
  ["goose", ["GOOSE_PROVIDER"]],
  // Meta's Muse: its VM harness is codenamed Jarvis (env list read 2026-09-25).
  // Two Sentinel/VM-specific names, not a bare JARVIS_* prefix, which other
  // tools could use.
  ["muse", ["JARVIS_SENTINEL_HTTP_API_SOCKET", "JARVIS_HATCHLING_ID"]],
  ["auggie", ["AUGMENT_AGENT"]],
  ["junie", ["JUNIE_DATA", "JUNIE_SHIM_PATH"]],
  ["cursor", ["CURSOR_AGENT"]],
];
function detectHarness(env = process.env) {
  if (env.CLAWLINK_NO_HARNESS) return null;
  const declared = (env.AI_AGENT || env.AGENT || "").trim().toLowerCase();
  if (["0", "false", "no", "off"].includes(declared)) return null; // explicit opt-out, like CI=false
  // Name only: Claude Code sends "claude-code_2-1-278_agent", the convention
  // allows "devin@1". The harness version is noise for our analytics.
  if (declared) return declared.split(/[/@_\s]/)[0].replace(/[^a-z0-9.-]/g, "") || null;
  for (const [name, keys] of HARNESS_MARKERS) if (keys.some((k) => env[k])) return name;
  if (/\.pi[\\/]agent/.test(env.PATH || "")) return "pi";
  return null;
}
const HARNESS = detectHarness();
const UA = `@useclawlink/cli/${VERSION}${HARNESS ? ` (harness=${HARNESS})` : ""}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = (s = "") => process.stdout.write(s + "\n");
const err = (s = "") => process.stderr.write(s + "\n");

// Tool payloads go to an agent's context far more often than to human eyes, and
// 2-space indentation measures out at 15-18% of every payload. So: compact when
// stdout is captured (a pipe — i.e. an agent shelling out), indented when a
// person is watching a terminal. `--compact` / `--pretty` force either way.
const PRETTY =
  process.argv.includes("--pretty") ||
  (!process.argv.includes("--compact") && process.stdout.isTTY === true);
/** Serialize a tool payload for stdout. Config files keep their own indentation. */
const json = (value) => JSON.stringify(value, null, PRETTY ? 2 : 0);

function loadKey() {
  if (process.env.CLAWLINK_API_KEY?.trim()) return process.env.CLAWLINK_API_KEY.trim();
  try {
    return JSON.parse(readFileSync(CONFIG_FILE, "utf8")).apiKey || null;
  } catch {
    return null;
  }
}

function saveKey(apiKey, meta = {}) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CONFIG_FILE, JSON.stringify({ apiKey, baseUrl: BASE_URL, ...meta }, null, 2));
  try { chmodSync(CONFIG_FILE, 0o600); } catch {}
}

/**
 * Try to open `url` in a browser; resolves true only once the child actually
 * spawned. On POSIX a missing binary (e.g. no xdg-open) is an async 'error'
 * event, not a sync throw — resolving on the 'spawn'/'error' pair instead of
 * "spawn() didn't throw" is what lets callers print "opening your browser" vs
 * "open the URL manually" truthfully, in order, on stdout.
 */
function openBrowser(url) {
  const browserEnv = process.env.BROWSER?.trim();
  if (browserEnv && ["none", "false", "0"].includes(browserEnv.toLowerCase())) return Promise.resolve(false);
  let cmd, args;
  if (browserEnv) {
    [cmd, args] = [browserEnv, [url]];
  } else if (platform() === "darwin") {
    [cmd, args] = ["open", [url]];
  } else if (platform() === "win32") {
    [cmd, args] = ["cmd", ["/c", "start", "", url]];
  } else {
    // No display server means no browser to open — the caller prints the URL.
    if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) return Promise.resolve(false);
    [cmd, args] = ["xdg-open", [url]];
  }
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { stdio: "ignore", detached: true });
    } catch {
      resolve(false);
      return;
    }
    // Both listeners are needed: without 'error', a missing binary's async
    // ENOENT kills the whole process mid-pairing; 'spawn' is the only event
    // that proves the opener really started.
    child.once("spawn", () => {
      child.unref();
      resolve(true);
    });
    child.once("error", () => resolve(false));
  });
}

async function api(path, { method = "GET", body, key } = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      "user-agent": UA,
      ...(key ? { authorization: `Bearer ${key}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = null; }
  if (!res.ok) {
    const msg = parsed?.error || `${res.status} ${res.statusText}`;
    throw new Error(msg);
  }
  return parsed;
}

/** Call a clawlink.* tool via the hosted MCP endpoint; returns the raw payload. */
async function callTool(name, args = {}) {
  const key = loadKey();
  if (!key) throw new Error("Not logged in. Run `clawlink login` first.");
  const rpc = await api("/api/mcp", {
    method: "POST",
    key,
    body: { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } },
  });
  if (rpc?.error) throw new Error(rpc.error.message || "Tool call failed");
  return rpc?.result?.structuredContent ?? rpc?.result ?? null;
}

function findUrl(obj) {
  let found = null;
  JSON.stringify(obj, (k, v) => {
    if (!found && typeof v === "string" && /^https?:\/\//.test(v)) found = v;
    return v;
  });
  return found;
}

// ---- commands ------------------------------------------------------------

async function cmdLogin() {
  const label = `ClawLink CLI (${platform()})`;
  const start = await api("/api/openclaw/pair/start", {
    method: "POST",
    // `client: "cli"` flags this as a generic-agent CLI pairing (vs the OpenClaw
    // plugin, which shares the same endpoint) so the dashboard labels it "CLI".
    body: { deviceLabel: label, client: "cli" },
  });
  const { sessionToken, displayCode, verifier, pollIntervalMs } = start;
  // utm_source: CLI-opened browsers send no referrer, so without this every
  // CLI-driven signup shows up as "direct" in analytics.
  const pairUrl = `${BASE_URL}/pair/${encodeURIComponent(sessionToken)}?utm_source=clawlink-cli&utm_medium=agent`;

  out("");
  out("  Sign in to ClawLink to authorize this device:");
  out(`  \x1b[1m${pairUrl}\x1b[0m`);
  out(`  Verification code: \x1b[1m${displayCode}\x1b[0m`);
  out("");
  if (await openBrowser(pairUrl)) out("  (opening your browser — approve there, then come back)");
  else out("  Open the URL above in a browser and approve.");
  out("  Waiting for approval…");

  const deadline = Date.now() + 15 * 60 * 1000;
  const interval = pollIntervalMs || 3000;
  while (Date.now() < deadline) {
    await sleep(interval);
    const { session } = await api(`/api/openclaw/pair/sessions/${encodeURIComponent(sessionToken)}`);
    if (session.status === "ready_for_device" || session.status === "awaiting_local_save") {
      const exchanged = await api(`/api/openclaw/pair/sessions/${encodeURIComponent(sessionToken)}/exchange`, {
        method: "POST",
        body: { verifier },
      });
      saveKey(exchanged.apiKey, { apiKeyId: exchanged.apiKeyId, label, approvedAt: session.approvedAt });
      try {
        await api(`/api/openclaw/pair/sessions/${encodeURIComponent(sessionToken)}/finalize`, { method: "POST", body: { verifier } });
      } catch {}
      const who = session.approvedUserHint ? ` as ${session.approvedUserHint}` : "";
      out(`\n  ✓ Logged in${who}. Credential saved to ${CONFIG_FILE}`);
      out("  Next: `clawlink connect <app>` (e.g. gmail), then `clawlink apps`.");
      out("  Using Claude Code, Cursor, Windsurf, or Claude Desktop? `clawlink install <client>` wires it up.");
      return;
    }
    if (["expired", "failed"].includes(session.status)) {
      throw new Error(`Pairing ${session.status}. Run \`clawlink login\` again.`);
    }
  }
  throw new Error("Pairing timed out. Run `clawlink login` again.");
}

function cmdLogout() {
  if (existsSync(CONFIG_FILE)) rmSync(CONFIG_FILE);
  out("Logged out (local credential removed).");
}

async function cmdWhoami() {
  out(json(await callTool("clawlink.whoami")));
}

/** Splits `--flag=value` into two entries so both spellings parse the same. */
function expandFlags(args) {
  return args.flatMap((arg) => {
    const match = /^(--[a-z-]+)=(.*)$/.exec(arg);
    return match ? [match[1], match[2]] : [arg];
  });
}

async function cmdApps(argv) {
  // argv[0] is the command name. A bare word is a catalog search: there are
  // 1,000+ integrations, so one page is never the whole catalog and an agent
  // that reads page 1 as "everything ClawLink supports" is wrong.
  const args = expandFlags(argv.slice(1));
  let query;
  let page;
  let limit;
  let connectedOnly = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--connected") {
      connectedOnly = true;
    } else if (arg === "--pretty" || arg === "--compact") {
      // Global output flags, handled at module load.
    } else if (arg === "--page" || arg === "--limit") {
      const value = Number(args[i + 1]);
      if (!Number.isFinite(value) || value < 1) throw new Error(`${arg} needs a positive number`);
      if (arg === "--page") page = Math.floor(value);
      else limit = Math.floor(value);
      i += 1;
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown flag: ${arg}. Usage: clawlink apps [query] [--connected] [--page N] [--limit N]`);
    } else if (query === undefined) {
      query = arg;
    }
  }

  const res = await callTool("clawlink.list_integrations", {
    ...(query ? { query } : {}),
    ...(connectedOnly ? { connected_only: true } : {}),
    ...(page ? { page } : {}),
    ...(limit ? { page_size: limit } : {}),
  });

  // Print the whole envelope, not just the rows. The old code unwrapped
  // `res.items` and threw away `total`, so a 25-row page looked like the
  // entire catalog and agents concluded an app was unsupported.
  out(json(res));

  const items = Array.isArray(res?.items) ? res.items : [];
  const total = typeof res?.total === "number" ? res.total : items.length;
  const currentPage = typeof res?.page === "number" ? res.page : 1;
  const pageSize = typeof res?.page_size === "number" ? res.page_size : items.length;
  const shown = (currentPage - 1) * pageSize + items.length;

  // Hints on stderr so stdout stays valid JSON for `| jq`.
  if (query && total === 0) {
    err(`\n  No integration matched "${query}". Try a shorter word, or run \`clawlink apps\` to browse.`);
  } else if (total > shown) {
    const queryArg = query ? `${query} ` : "";
    const connectedArg = connectedOnly ? "--connected " : "";
    const limitArg = limit ? `--limit ${limit} ` : "";
    err(`\n  Showing ${items.length} of ${total}. Next page:`);
    err(`  clawlink apps ${queryArg}${connectedArg}${limitArg}--page ${currentPage + 1}`);
    if (!query) err(`  Or search by name: clawlink apps <word>`);
  }
}

async function cmdConnect(slug) {
  if (!slug) throw new Error("Usage: clawlink connect <app-slug>");
  const res = await callTool("clawlink.connect_app", { integration_id: slug });
  const url = findUrl(res);
  if (url) {
    out(`\n  Connect ${slug}:`);
    out(`  \x1b[1m${url}\x1b[0m`);
    // Only claim the browser opened if it actually did (see openBrowser).
    if (await openBrowser(url)) out("  (opening your browser — approve there)");
    else out("  Open the URL above in a browser and approve.");
  } else {
    out(json(res));
  }
}

async function cmdConnections(slug) {
  if (!slug) throw new Error("Usage: clawlink connections <app-slug>");
  const res = await callTool("clawlink.get_connection", { integration_id: slug });
  out(json(res));
  // Multi-account discoverability: when several connections exist, name the
  // flag that targets one (on stderr so stdout stays valid JSON for `| jq`).
  const list = Array.isArray(res?.connections) ? res.connections : [];
  if (list.length > 1) {
    err(`\n  ${list.length} ${slug} connections:`);
    for (const c of list) {
      err(`    ${c?.connection_id}  ${c?.label ?? "(unlabeled)"}${c?.is_default ? "  [default]" : ""}`);
    }
    err(`  Target one: clawlink run ${slug} <action> --connection <id>`);
  }
}

async function cmdDisconnect(slug, argv) {
  if (!slug) throw new Error("Usage: clawlink disconnect <app-slug> [--connection <id>] [--confirm]");
  const c = argv.indexOf("--connection");
  let connectionId;
  if (c >= 0) {
    connectionId = Number(argv[c + 1]);
    if (!Number.isFinite(connectionId)) {
      throw new Error("--connection needs a numeric connection id (see: clawlink connections <app>)");
    }
  }
  const confirm = argv.includes("--confirm") || argv.includes("--yes") || argv.includes("-y");
  const res = await callTool("clawlink.disconnect", {
    integration_id: slug,
    ...(connectionId !== undefined ? { connection_id: connectionId } : {}),
    ...(confirm ? { confirm: true } : {}),
  });
  out(json(res));
  // Idempotent-delete semantics: "already gone" is success. Only a pending
  // decision (confirm or pick-a-connection) exits non-zero, with the exact
  // re-run on stderr so stdout stays valid JSON.
  if (res?.status === "needs_confirmation") {
    const connectionArg = res?.connection?.connection_id ? ` --connection ${res.connection.connection_id}` : "";
    err(`\n  Nothing was disconnected yet. Re-run with --confirm:`);
    err(`  clawlink disconnect ${slug}${connectionArg} --confirm`);
    process.exit(1);
  }
  if (res?.status === "needs_connection_id") {
    err(`\n  Pick a connection: clawlink disconnect ${slug} --connection <id> --confirm`);
    process.exit(1);
  }
}

async function cmdActions(argv) {
  // --short asks the server for compact rows (action_id + side_effect_level,
  // ~6x fewer tokens than full descriptions) — for agents scanning for a
  // name. Distinct from the global --compact, which only strips indentation.
  const args = expandFlags(argv.slice(1));
  let slug;
  let intent;
  let short = false;
  let page;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--short") {
      short = true;
    } else if (arg === "--page") {
      const value = Number(args[i + 1]);
      if (!Number.isFinite(value) || value < 1) throw new Error("--page needs a positive number");
      page = Math.floor(value);
      i += 1;
    } else if (arg === "--pretty" || arg === "--compact") {
      // Global output flags, handled at module load.
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown flag: ${arg}. Usage: clawlink actions <app-slug> [intent] [--short] [--page N]`);
    } else if (slug === undefined) {
      slug = arg;
    } else if (intent === undefined) {
      intent = arg;
    }
  }

  if (!slug) throw new Error("Usage: clawlink actions <app-slug> [intent] [--short] [--page N]");
  const res = await callTool("clawlink.list_actions", {
    integration_id: slug,
    ...(intent ? { intent } : {}),
    ...(short ? { compact: true } : {}),
    ...(page ? { page } : {}),
  });
  out(json(res?.actions || res));
}

async function cmdDescribe(slug, action) {
  if (!slug || !action) throw new Error("Usage: clawlink describe <app-slug> <action-id>");
  const res = await callTool("clawlink.get_action", { integration_id: slug, action_id: action });
  out(json(res));
  // Discoverability: surface the confirmation gate as a human-readable note so it
  // isn't buried in the JSON, and name the flag that satisfies it.
  if (res?.requires_confirmation) {
    err(`\n  Note: this action requires confirmation — run it with --confirm.`);
  }
}

async function cmdRun(slug, action, argv) {
  if (!slug || !action) throw new Error("Usage: clawlink run <app-slug> <action-id> [--input '<json>'] [--connection <id>] [--confirm]");
  const i = argv.indexOf("--input");
  let input = {};
  // A bare trailing flag must fail, not run the action with `{}`.
  if (i >= 0 && !argv[i + 1]) throw new Error("--input needs a JSON value");
  if (i >= 0) {
    try { input = JSON.parse(argv[i + 1]); } catch { throw new Error("--input must be valid JSON"); }
  }
  // Users can hold several connections for one app (two Instagram accounts, two
  // Slack workspaces). `--connection <id>` picks one; omitted = the default
  // connection. Ids come from `clawlink connections <app>`.
  const c = argv.indexOf("--connection");
  let connectionId;
  if (c >= 0) {
    connectionId = Number(argv[c + 1]);
    if (!Number.isFinite(connectionId)) {
      throw new Error("--connection needs a numeric connection id (see: clawlink connections <app>)");
    }
  }
  // Write/destructive actions are gated server-side and refused unless the caller
  // explicitly opts in. There's no interactive prompt on this surface, so
  // `--confirm` (alias `-y`/`--yes`) is how a script or agent says "I intend this
  // write." Deliberately per-invocation — there is no persisted or env default
  // that silently auto-confirms every call.
  const confirm = argv.includes("--confirm") || argv.includes("--yes") || argv.includes("-y");
  const result = await callTool("clawlink.execute", {
    integration_id: slug,
    action_id: action,
    input,
    ...(connectionId !== undefined ? { connection_id: connectionId } : {}),
    ...(confirm ? { confirm: true } : {}),
  });
  out(json(result));
  // The server blocks writes pending confirmation. Point at the exact re-run
  // command (on stderr, so stdout stays valid JSON) and exit non-zero so scripts
  // can detect the block instead of mistaking it for a successful run.
  if (!confirm && result?.status === "blocked" && /\bconfirm/i.test(result?.message || "")) {
    const inputArg = i >= 0 ? ` --input '${argv[i + 1]}'` : "";
    const connectionArg = connectionId !== undefined ? ` --connection ${connectionId}` : "";
    err(`\n  This action changes data and was not run. Re-run with --confirm:`);
    err(`  clawlink run ${slug} ${action}${inputArg}${connectionArg} --confirm`);
    process.exit(1);
  }
  // Any non-success must exit non-zero — a blocked run (bad connection id,
  // missing connection) used to exit 0, so scripts read failure as success.
  if (result?.status === "blocked" || result?.status === "failed") {
    process.exit(1);
  }
}

// ---- install: write the MCP-client config so the user never edits JSON ----
//
// The shim (@useclawlink/mcp >=0.2.0) reads ~/.clawlink/credentials.json on
// its own, so after `clawlink login` the client entry needs no env var and no
// key ever lands in a config file. Only when the key exists solely as
// CLAWLINK_API_KEY (no login) do we embed it, because the client launches the
// shim in a fresh environment that won't inherit this shell's variables.

const INSTALL_CLIENTS = ["claude-code", "cursor", "windsurf", "claude-desktop"];

function claudeDesktopConfigPath() {
  if (platform() === "darwin") {
    return join(homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
  }
  if (platform() === "win32") {
    return join(process.env.APPDATA || join(homedir(), "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
  }
  return join(homedir(), ".config", "Claude", "claude_desktop_config.json");
}

function cmdInstall(client, argv) {
  const usage = () => {
    out(`Usage: clawlink install <client> [--project]\n`);
    out(`  Clients: ${INSTALL_CLIENTS.join(", ")}`);
    out(`  --project   claude-code/cursor only: install for this project instead of globally`);
  };
  if (!client) { usage(); return; }

  const loggedIn = existsSync(CONFIG_FILE);
  const envKey = process.env.CLAWLINK_API_KEY?.trim();
  if (!loggedIn && !envKey) {
    throw new Error("Not logged in. Run `clawlink login` first, then re-run install.");
  }
  const entry = { command: "npx", args: ["-y", "@useclawlink/mcp"] };
  if (!loggedIn && envKey) entry.env = { CLAWLINK_API_KEY: envKey };
  const project = argv.includes("--project");

  if (client === "claude-code") {
    const args = ["mcp", "add", "--scope", project ? "project" : "user", "--transport", "stdio"];
    if (entry.env) args.push("--env", `CLAWLINK_API_KEY=${envKey}`);
    args.push("clawlink", "--", "npx", "-y", "@useclawlink/mcp");
    const res = spawnSync("claude", args, { stdio: "inherit" });
    if (res.error || res.status !== 0) {
      err(`\n  Couldn't run the Claude Code CLI. Run this yourself:`);
      err(`  claude ${args.map((s) => (/\s/.test(s) ? JSON.stringify(s) : s)).join(" ")}`);
      process.exit(1);
    }
    out(`\n  ✓ ClawLink added to Claude Code. Try: "What can you do with Gmail?"`);
    return;
  }

  const files = {
    cursor: project ? join(process.cwd(), ".cursor", "mcp.json") : join(homedir(), ".cursor", "mcp.json"),
    windsurf: join(homedir(), ".codeium", "windsurf", "mcp_config.json"),
    "claude-desktop": claudeDesktopConfigPath(),
  };
  const restart = {
    cursor: "Restart Cursor, then enable ClawLink under Settings → MCP.",
    windsurf: "Restart Windsurf to pick up the new server.",
    "claude-desktop": "Restart Claude Desktop to pick up the new server.",
  };
  const file = files[client];
  if (!file) {
    err(`Unknown client: ${client}\n`);
    usage();
    out(`\n  For any other stdio MCP client, add this to its config file:`);
    out(`  ${JSON.stringify({ mcpServers: { clawlink: entry } }, null, 2)}`);
    process.exit(1);
  }

  let config = {};
  if (existsSync(file)) {
    try {
      config = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      // Never clobber a config we can't parse — hand the user the snippet instead.
      err(`  ✗ ${file} exists but isn't valid JSON. Add this entry to it yourself:`);
      err(`  "clawlink": ${JSON.stringify(entry, null, 2)}`);
      process.exit(1);
    }
  }
  if (typeof config.mcpServers !== "object" || config.mcpServers === null) config.mcpServers = {};
  config.mcpServers.clawlink = entry;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
  out(`\n  ✓ ClawLink added to ${file}`);
  out(`  ${restart[client]}`);
}

// ---- skill: drop SKILL.md into every agent that is already on this machine ----
//
// A skill needs no MCP entry: the agent shells out to `npx -y @useclawlink/cli`.
// Only agents whose config dir already exists get the file; creating ~/.qwen on a
// machine with no Qwen is litter. `skill remove` deletes exactly what install wrote.

const SKILL_SRC = join(dirname(fileURLToPath(import.meta.url)), "SKILL.md");
const AGENT_DIRS = {
  "Claude Code": process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"),
  Cursor: join(homedir(), ".cursor"),
  Codex: join(homedir(), ".codex"),
  "Gemini CLI": join(homedir(), ".gemini"),
  Copilot: join(homedir(), ".copilot"),
  opencode: join(homedir(), ".config", "opencode"),
  Windsurf: join(homedir(), ".codeium", "windsurf"),
  Roo: join(homedir(), ".roo"),
  Continue: join(homedir(), ".continue"),
  "Qwen Code": join(homedir(), ".qwen"),
  Kilo: join(homedir(), ".kilocode"),
  Goose: join(homedir(), ".config", "goose"),
};

function cmdSkill(sub) {
  if (!["install", "remove"].includes(sub)) {
    out(`Usage: clawlink skill <install|remove>\n`);
    out(`  install   Write the ClawLink skill into every agent found on this machine`);
    out(`  remove    Delete the skill from every agent it was written to`);
    out(`  Agents:   ${Object.keys(AGENT_DIRS).join(", ")}`);
    return;
  }
  const found = Object.entries(AGENT_DIRS).filter(([, dir]) => existsSync(dir));
  if (found.length === 0) {
    out(`\n  No agent config folder found (looked for ${Object.keys(AGENT_DIRS).join(", ")}).`);
    return;
  }
  const skill = sub === "install" ? readFileSync(SKILL_SRC, "utf8") : null;
  for (const [name, dir] of found) {
    const target = join(dir, "skills", "clawlink");
    if (skill) {
      mkdirSync(target, { recursive: true });
      writeFileSync(join(target, "SKILL.md"), skill);
      out(`  ✓ ${name.padEnd(11)} ${join(target, "SKILL.md")}`);
    } else if (existsSync(target)) {
      rmSync(target, { recursive: true, force: true });
      out(`  ✓ ${name.padEnd(11)} removed ${target}`);
    }
  }
  if (skill) out(`\n  Each agent now knows how to use ClawLink. Run \`clawlink login\` once if you haven't.`);
}

// Per-command help for `<command> --help` / `-h`. Exits 0 — `run --help` used
// to be parsed as an app slug and die with a bare usage error (exit 1).
const COMMAND_HELP = {
  login: `clawlink login — sign in via browser

  Runs ClawLink's device-pairing flow: a browser page approves this device,
  an API key is minted and stored at ~/.clawlink/credentials.json (0600).
  No key to copy, no config to edit.`,
  install: `clawlink install <client> [--project] — add ClawLink to an MCP client

  Clients: ${INSTALL_CLIENTS.join(", ")}
  Writes the client's MCP config so its agent can use ClawLink.
  --project scopes the config to the current project where supported.`,
  skill: `clawlink skill <install|remove> — teach every agent on this machine to use ClawLink

  install writes skills/clawlink/SKILL.md into each agent config folder that
  already exists (${Object.keys(AGENT_DIRS).join(", ")}).
  No MCP entry needed: the skill tells the agent to run this CLI.
  remove deletes exactly those files.`,
  logout: `clawlink logout — remove the locally stored credential`,
  whoami: `clawlink whoami — show the signed-in ClawLink account`,
  apps: `clawlink apps [query] [--connected] [--page N] [--limit N] — list integrations

  A query searches the catalog (1,000+ apps; one page is not the whole catalog —
  the response carries "total"). --connected lists only connected apps.`,
  connect: `clawlink connect <app> — connect an app

  Opens the browser OAuth/credential flow for the app (e.g. gmail).
  Approve there, then verify with: clawlink connections <app>`,
  connections: `clawlink connections <app> — show connection health

  Prints the connection state for the app. When the app is connected to more
  than one account, lists every connection with its id, label, and default
  marker; target one on execution with: clawlink run <app> <action> --connection <id>`,
  disconnect: `clawlink disconnect <app> [--connection <id>] [--confirm] — remove a connection

  Deletes the connection and revokes its stored credentials. Not undoable —
  the app would have to be reconnected. Without --confirm it previews what
  would be deleted and exits non-zero. With several connections for the app,
  --connection <id> picks one (ids from: clawlink connections <app>).`,
  actions: `clawlink actions <app> [intent] [--short] [--page N] — list actions for an app

  An optional intent phrase (e.g. "send an email") ranks matching actions first.
  Large apps list 50 actions per page — the response's total/hint say when more
  exist; --page 2 fetches the next window (ignored when an intent is given).
  --short returns action ids + side-effect levels only (much smaller output);
  full details for one action come from: clawlink describe <app> <action>`,
  describe: `clawlink describe <app> <action> — show an action's schema

  Prints the full input schema and flags writes that need --confirm.`,
  run: `clawlink run <app> <action> [--input '<json>'] [--connection <id>] [--confirm] — execute an action

  --input '<json>'    Arguments for the action (JSON object)
  --connection <id>   Target one of several connected accounts for the app
                      (ids from: clawlink connections <app>). Omitted = default.
  --confirm (-y)      Allow write/delete actions (gated server-side, per-invocation)

  Exits non-zero when the run is blocked or fails, so scripts can detect it.

  Example:
    clawlink run gmail send_email --input '{"to":"a@b.c","subject":"hi"}' --confirm`,
};

function cmdCommandHelp(cmd) {
  const text = COMMAND_HELP[cmd];
  if (!text) {
    cmdHelp();
    return;
  }
  out(`\n${text}\n`);
}

function cmdHelp() {
  out(`clawlink ${VERSION} — connect your apps to your AI agent

Usage: clawlink <command>

  login                         Sign in via browser (mints + stores an API key)
  install <client> [--project]  Add ClawLink to an MCP client's config
                                (claude-code, cursor, windsurf, claude-desktop)
  skill <install|remove>        Write the ClawLink skill into every agent found
                                on this machine (no MCP config needed)
  logout                        Remove the local credential
  whoami                        Show the signed-in ClawLink account
  apps [query] [--connected] [--page N] [--limit N]
                                List integrations; a query searches the catalog
                                (1,000+ apps, so one page is not all of them)
  connect <app>                 Connect an app (opens browser OAuth), e.g. gmail
  connections <app>             Show connection health; lists ids when the app
                                is connected to more than one account
  disconnect <app> [--connection <id>] [--confirm]
                                Remove a connection and revoke its credentials
  actions <app> [intent] [--short] [--page N]
                                List actions for an app; --short = ids only
  describe <app> <action>       Show an action's schema (flags writes needing --confirm)
  run <app> <action> [--input '<json>'] [--connection <id>] [--confirm]
                                Execute an action; --confirm (-y) allows writes & deletes;
                                --connection targets one of several accounts
  help                          Show this help (or: clawlink <command> --help)

JSON output is compact when piped or captured and indented in a terminal.
--compact / --pretty force either mode on any command.

Env: CLAWLINK_API_KEY (skip login), CLAWLINK_BASE_URL (override host),
     BROWSER (command used to open URLs; "none" disables)`);
}

async function main() {
  const [cmd, a, b, ...rest] = process.argv.slice(2);
  const argv = process.argv.slice(2);
  try {
    // `<command> --help` prints that command's help and exits 0 — before this,
    // e.g. `run --help` parsed "--help" as the app slug and died with a bare
    // usage error. The bare-`--help` case still falls through to cmdHelp below.
    if (cmd && !["help", "-h", "--help"].includes(cmd) && (argv.includes("--help") || argv.includes("-h"))) {
      return cmdCommandHelp(cmd);
    }
    switch (cmd) {
      case "login": return await cmdLogin();
      case "install": return cmdInstall(a, argv);
      case "skill": return cmdSkill(a);
      case "logout": return cmdLogout();
      case "whoami": return await cmdWhoami();
      case "apps": return await cmdApps(argv);
      case "connect": return await cmdConnect(a);
      case "connections": return await cmdConnections(a);
      case "disconnect": return await cmdDisconnect(a, argv);
      case "actions": return await cmdActions(argv);
      case "describe": return await cmdDescribe(a, b);
      case "run": return await cmdRun(a, b, rest);
      case undefined:
      case "help":
      case "-h":
      case "--help": return cmdHelp();
      default:
        err(`Unknown command: ${cmd}`);
        cmdHelp();
        process.exit(1);
    }
  } catch (e) {
    err(`\n  ✗ ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }
}

main();
