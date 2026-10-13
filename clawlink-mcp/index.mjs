#!/usr/bin/env node
/**
 * ClawLink MCP shim — a transparent stdio <-> HTTP JSON-RPC proxy.
 *
 * ClawLink already exposes a full, spec-compliant MCP server over HTTP at
 * `${BASE_URL}/api/mcp` (initialize, tools/list, tools/call, prompts, resources).
 * This shim lets any MCP client that only speaks stdio (Claude Code, Cursor,
 * Cline, Windsurf, etc.) talk to it: it reads newline-delimited JSON-RPC from
 * stdin, forwards each message to the HTTP endpoint with the user's API key,
 * and writes the responses back to stdout. It is intentionally dependency-free
 * and tool-agnostic — it forwards bytes, it does not model the tool surface.
 */

import { createInterface } from "node:readline";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_BASE_URL = "https://claw-link.dev";
const VERSION = "0.2.0";

// Fallback credential: the file `clawlink login` (@useclawlink/cli) writes.
// This is what lets an MCP-client user skip the dashboard entirely — login
// once in a terminal, then add this shim to any client with no env var.
// The stored baseUrl travels with the key so a key minted against a custom
// host isn't replayed against the default one.
const CREDENTIALS_FILE = join(homedir(), ".clawlink", "credentials.json");
let storedCredentials = null;
try {
  storedCredentials = JSON.parse(readFileSync(CREDENTIALS_FILE, "utf8"));
} catch {
  // No file / unreadable / invalid JSON — env var remains the only source.
}

const baseUrl = (process.env.CLAWLINK_BASE_URL || storedCredentials?.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
const endpoint = `${baseUrl}/api/mcp`;
const apiKey = (process.env.CLAWLINK_API_KEY || storedCredentials?.apiKey || "").trim();

function logStderr(message) {
  process.stderr.write(`[clawlink-mcp] ${message}\n`);
}

if (!apiKey) {
  logStderr(
    "No ClawLink credential found. Either run `npx -y @useclawlink/cli login` once " +
      `(stores a key at ${CREDENTIALS_FILE}), or create a key at ` +
      "https://claw-link.dev/dashboard/devices and set it in your " +
      "MCP client config (env.CLAWLINK_API_KEY).",
  );
  process.exit(1);
}

const headers = {
  "content-type": "application/json",
  accept: "application/json",
  authorization: `Bearer ${apiKey}`,
  "user-agent": `@useclawlink/mcp/${VERSION}`,
};

function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function errorResponse(id, code, message) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

async function forward(message) {
  // A request without an `id` is a JSON-RPC notification: forward it, but never
  // emit a response (the client is not waiting for one).
  const isNotification = message.id === undefined;

  let response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(message),
    });
  } catch (cause) {
    if (!isNotification) {
      writeMessage(errorResponse(message.id, -32000, `Network error reaching ClawLink: ${cause?.message ?? cause}`));
    }
    return;
  }

  if (isNotification) {
    return;
  }

  if (response.status === 401) {
    writeMessage(
      errorResponse(
        message.id,
        -32001,
        "Unauthorized — the stored ClawLink credential was rejected. Re-run `npx -y @useclawlink/cli login`, or check CLAWLINK_API_KEY.",
      ),
    );
    return;
  }

  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    writeMessage(
      errorResponse(message.id, -32700, `Invalid JSON from ClawLink (HTTP ${response.status}): ${text.slice(0, 200)}`),
    );
    return;
  }

  writeMessage(parsed);
}

const rl = createInterface({ input: process.stdin });
const pending = new Set();

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }

  let message;
  try {
    message = JSON.parse(trimmed);
  } catch {
    logStderr(`Dropping non-JSON line: ${trimmed.slice(0, 120)}`);
    return;
  }

  // Each message carries its own id, so responses may arrive out of order
  // without confusing the client. Track in-flight work so we can drain on close.
  const work = forward(message).finally(() => pending.delete(work));
  pending.add(work);
});

rl.on("close", async () => {
  await Promise.allSettled(pending);
  process.exit(0);
});
