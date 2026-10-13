import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import clawlinkPlugin from "./index.js";

const MAX_FILE_UPLOAD_BYTES = 25 * 1024 * 1024;

function createFakeApi(initialPluginConfig = {
  apiKey: "cllk_test_123",
}) {
  const tools = new Map();
  const commands = new Map();
  let fileConfig = {
    plugins: {
      entries: {
        "clawlink-plugin": {
          enabled: true,
          config: structuredClone(initialPluginConfig),
        },
      },
    },
  };

  return {
    id: "clawlink-plugin",
    pluginConfig: structuredClone(initialPluginConfig),
    runtime: {
      config: {
        loadConfig() {
          return structuredClone(fileConfig);
        },
        async writeConfigFile(nextConfig) {
          fileConfig = structuredClone(nextConfig);
          return fileConfig;
        },
      },
    },
    registerCommand(definition) {
      commands.set(definition.name, definition);
    },
    registerTool(definition) {
      tools.set(definition.name, definition);
    },
    getTool(name) {
      const tool = tools.get(name);
      assert.ok(tool, `Expected tool ${name} to be registered`);
      return tool;
    },
    getCommand(name) {
      const command = commands.get(name);
      assert.ok(command, `Expected command ${name} to be registered`);
      return command;
    },
    getPluginConfig() {
      return structuredClone(fileConfig.plugins.entries["clawlink-plugin"].config);
    },
  };
}

async function withFetchMock(handler, run) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = handler;

  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function successResponse(payload = {}) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function createUploadFixture(filename = "sample.txt", bytes = Buffer.from("hello file")) {
  const root = mkdtempSync(path.join(os.tmpdir(), "clawlink-file-upload-"));
  const mediaDir = path.join(root, ".openclaw", "media", "inbound");
  mkdirSync(mediaDir, { recursive: true });
  const filePath = path.join(mediaDir, filename);
  writeFileSync(filePath, bytes);

  return {
    root,
    filePath,
    bytes,
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

// Mirrors createUploadFixture but places the file in an arbitrary `.openclaw/`
// subdir (e.g. a `workspace-<name>` the agent generated content in).
function createOpenclawSubdirFixture(subdir, filename = "sample.txt", bytes = Buffer.from("hello file")) {
  const root = mkdtempSync(path.join(os.tmpdir(), "clawlink-file-upload-"));
  const dir = path.join(root, ".openclaw", subdir);
  mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, filename);
  writeFileSync(filePath, bytes);

  return {
    root,
    filePath,
    bytes,
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test("ClawHub mirror avoids local file reads so OpenClaw code-safety scan stays clean", () => {
  const mirrorSource = readFileSync(
    new URL("../openclaw-clawlink-clawhub/index.js", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(mirrorSource, /\breadFile(?:Sync)?\b/);
  assert.doesNotMatch(mirrorSource, /\bstatSync\b/);
  assert.doesNotMatch(mirrorSource, /\bdataBase64\b/);
  assert.match(mirrorSource, /\bfetch\s*\(/);
});

test("clawlink_call_tool forwards nested arguments unchanged", async () => {
  const api = createFakeApi();
  clawlinkPlugin.register(api);
  const tool = api.getTool("clawlink_call_tool");
  let capturedRequest = null;

  await withFetchMock(async (url, options) => {
    capturedRequest = {
      url,
      method: options.method,
      headers: options.headers,
      body: JSON.parse(options.body),
    };

    return successResponse({ ok: true });
  }, async () => {
    await tool.execute("test", {
      tool: "gmail_send_email",
      arguments: {
        to: ["person@example.com"],
        subject: "Hello",
        body: "Test body",
      },
      connectionId: 12,
      confirmed: true,
    });
  });

  assert.deepEqual(capturedRequest, {
    url: "https://claw-link.dev/api/tools/gmail_send_email/execute",
    method: "POST",
    headers: {
	      "X-ClawLink-API-Key": "cllk_test_123",
	      "Content-Type": "application/json",
	      "User-Agent": "@useclawlink/openclaw-plugin/0.3.9",
              "x-clawlink-capabilities": "offload",
	    },
    body: {
      arguments: {
        to: ["person@example.com"],
        subject: "Hello",
        body: "Test body",
      },
      connectionId: 12,
      confirmed: true,
    },
  });
});

test("clawlink_call_tool attaches local FileUploadable bytes", async () => {
  const api = createFakeApi();
  clawlinkPlugin.register(api);
  const tool = api.getTool("clawlink_call_tool");
  const fixture = createUploadFixture("photo.jpg", Buffer.from("image bytes"));
  let capturedBody = null;

  try {
    await withFetchMock(async (_url, options) => {
      capturedBody = JSON.parse(options.body);
      return successResponse({ ok: true });
    }, async () => {
      await tool.execute("test", {
        tool: "instagram_post_ig_user_media",
        arguments: {
          caption: "New product",
          media: [
            {
              image_file: {
                name: "photo.jpg",
                mimetype: "image/jpeg",
                s3key: fixture.filePath,
              },
            },
          ],
        },
        confirmed: true,
      });
    });
  } finally {
    fixture.cleanup();
  }

  assert.equal(capturedBody.files.length, 1);
  assert.deepEqual(capturedBody.files[0], {
    pointer: fixture.filePath,
    name: "photo.jpg",
    mimetype: "image/jpeg",
    md5: createHash("md5").update(fixture.bytes).digest("hex"),
    dataBase64: fixture.bytes.toString("base64"),
  });
});

test("clawlink_preview_tool attaches local FileUploadable bytes", async () => {
  const api = createFakeApi();
  clawlinkPlugin.register(api);
  const tool = api.getTool("clawlink_preview_tool");
  const fixture = createUploadFixture("preview.txt", Buffer.from("preview bytes"));
  let capturedBody = null;

  try {
    await withFetchMock(async (_url, options) => {
      capturedBody = JSON.parse(options.body);
      return successResponse({ ok: true });
    }, async () => {
      await tool.execute("test", {
        tool: "slack_upload_file",
        arguments: {
          file: {
            name: "preview.txt",
            mimetype: "text/plain",
            s3key: fixture.filePath,
          },
        },
      });
    });
  } finally {
    fixture.cleanup();
  }

  assert.equal(capturedBody.files.length, 1);
  assert.equal(capturedBody.files[0].pointer, fixture.filePath);
  assert.equal(capturedBody.files[0].dataBase64, fixture.bytes.toString("base64"));
});

test("clawlink_call_tool leaves Apollo s3keys unchanged without reading files", async () => {
  const api = createFakeApi();
  clawlinkPlugin.register(api);
  const tool = api.getTool("clawlink_call_tool");
  let capturedBody = null;

  await withFetchMock(async (_url, options) => {
    capturedBody = JSON.parse(options.body);
    return successResponse({ ok: true });
  }, async () => {
    await tool.execute("test", {
      tool: "instagram_post_ig_user_media",
      arguments: {
        image_file: {
          name: "from-composio.jpg",
          mimetype: "image/jpeg",
          s3key: "123/INSTAGRAM/INSTAGRAM_POST_IG_USER_MEDIA/response/file_abc",
        },
      },
    });
  });

  assert.equal("files" in capturedBody, false);
  assert.equal(
    capturedBody.arguments.image_file.s3key,
    "123/INSTAGRAM/INSTAGRAM_POST_IG_USER_MEDIA/response/file_abc",
  );
});

test("clawlink_call_tool refuses path traversal without posting to ClawLink", async () => {
  const api = createFakeApi();
  clawlinkPlugin.register(api);
  const tool = api.getTool("clawlink_call_tool");
  let fetchCalled = false;

  const result = await withFetchMock(async () => {
    fetchCalled = true;
    return successResponse({ ok: true });
  }, async () => tool.execute("test", {
    tool: "instagram_post_ig_user_media",
    arguments: {
      image_file: {
        name: "secret.txt",
        mimetype: "text/plain",
        s3key: "/data/.openclaw/media/../../../etc/passwd",
      },
    },
  }));

  assert.equal(fetchCalled, false);
  assert.equal(result.details.error.code, "invalid_file_path");
  assert.match(result.content[0].text, /outside the permitted OpenClaw attachment roots/);
});

test("clawlink_call_tool attaches bytes for a file the agent generated in its own workspace", async () => {
  const api = createFakeApi();
  clawlinkPlugin.register(api);
  const tool = api.getTool("clawlink_call_tool");
  // A file the agent wrote into its own workspace — the dominant legitimate case
  // (e.g. an image it generated, then wants to post). Must upload, not be blocked.
  const fixture = createOpenclawSubdirFixture("workspace-ogilvy", "post.png", Buffer.from("png bytes"));
  let capturedBody = null;

  try {
    await withFetchMock(async (_url, options) => {
      capturedBody = JSON.parse(options.body);
      return successResponse({ ok: true });
    }, async () => {
      await tool.execute("test", {
        tool: "linkedin_create_linked_in_post",
        arguments: {
          author: "urn:li:person:abc",
          commentary: "hi",
          images: [{ name: "post.png", mimetype: "image/png", s3key: fixture.filePath }],
        },
      });
    });
  } finally {
    fixture.cleanup();
  }

  assert.equal(capturedBody.files.length, 1);
  assert.equal(capturedBody.files[0].pointer, fixture.filePath);
  assert.equal(capturedBody.files[0].dataBase64, fixture.bytes.toString("base64"));
});

test("clawlink_call_tool still blocks a non-allowlisted .openclaw subdir (e.g. config/secrets)", async () => {
  const api = createFakeApi();
  clawlinkPlugin.register(api);
  const tool = api.getTool("clawlink_call_tool");
  // `.openclaw/config` is not media/agents/workspace-* — the boundary must hold,
  // so an injected prompt cannot read credentials stashed elsewhere under .openclaw.
  const fixture = createOpenclawSubdirFixture("config", "credentials", Buffer.from("secret"));
  let fetchCalled = false;

  const result = await withFetchMock(async () => {
    fetchCalled = true;
    return successResponse({ ok: true });
  }, async () => {
    try {
      return await tool.execute("test", {
        tool: "linkedin_create_linked_in_post",
        arguments: {
          author: "urn:li:person:abc",
          commentary: "hi",
          images: [{ name: "credentials", mimetype: "application/octet-stream", s3key: fixture.filePath }],
        },
      });
    } finally {
      fixture.cleanup();
    }
  });

  assert.equal(fetchCalled, false);
  assert.equal(result.details.error.code, "invalid_file_path");
  assert.match(result.content[0].text, /outside the permitted OpenClaw attachment roots/);
});

test("clawlink_call_tool refuses oversize files locally", async () => {
  const api = createFakeApi();
  clawlinkPlugin.register(api);
  const tool = api.getTool("clawlink_call_tool");
  const fixture = createUploadFixture("big.bin", Buffer.from("x"));
  truncateSync(fixture.filePath, MAX_FILE_UPLOAD_BYTES + 1);
  let fetchCalled = false;

  try {
    const result = await withFetchMock(async () => {
      fetchCalled = true;
      return successResponse({ ok: true });
    }, async () => tool.execute("test", {
      tool: "drive_upload",
      arguments: {
        file: {
          name: "big.bin",
          mimetype: "application/octet-stream",
          s3key: fixture.filePath,
        },
      },
    }));

    assert.equal(fetchCalled, false);
    assert.equal(result.details.error.code, "file_too_large");
    assert.match(result.content[0].text, /exceeding the 26214400-byte cap/);
  } finally {
    fixture.cleanup();
  }
});

test("clawlink_call_tool falls back to top-level tool args", async () => {
  const api = createFakeApi();
  clawlinkPlugin.register(api);
  const tool = api.getTool("clawlink_call_tool");
  let capturedBody = null;

  await withFetchMock(async (_url, options) => {
    capturedBody = JSON.parse(options.body);
    return successResponse({ ok: true });
  }, async () => {
    await tool.execute("test", {
      tool: "gmail_send_email",
      to: ["person@example.com"],
      subject: "Hello",
      body: "Test body",
      connectionId: 12,
    });
  });

  assert.deepEqual(capturedBody, {
    arguments: {
      to: ["person@example.com"],
      subject: "Hello",
      body: "Test body",
    },
    connectionId: 12,
    confirmed: true,
  });
});

test("clawlink_call_tool prefers explicit arguments over top-level fallbacks", async () => {
  const api = createFakeApi();
  clawlinkPlugin.register(api);
  const tool = api.getTool("clawlink_call_tool");
  let capturedBody = null;

  await withFetchMock(async (_url, options) => {
    capturedBody = JSON.parse(options.body);
    return successResponse({ ok: true });
  }, async () => {
    await tool.execute("test", {
      tool: "gmail_send_email",
      arguments: {
        to: ["nested@example.com"],
        subject: "Nested",
        body: "Nested body",
      },
      to: ["top-level@example.com"],
      subject: "Top level",
      body: "Top level body",
      connectionId: 12,
      confirmed: false,
    });
  });

  assert.deepEqual(capturedBody, {
    arguments: {
      to: ["nested@example.com"],
      subject: "Nested",
      body: "Nested body",
    },
    connectionId: 12,
    confirmed: false,
  });
});

test("clawlink_preview_tool also accepts top-level tool args", async () => {
  const api = createFakeApi();
  clawlinkPlugin.register(api);
  const tool = api.getTool("clawlink_preview_tool");
  let capturedBody = null;

  await withFetchMock(async (_url, options) => {
    capturedBody = JSON.parse(options.body);
    return successResponse({ ok: true });
  }, async () => {
    await tool.execute("test", {
      tool: "gmail_send_email",
      to: ["person@example.com"],
      subject: "Preview",
      body: "Preview body",
      connectionId: 12,
    });
  });

  assert.deepEqual(capturedBody, {
    arguments: {
      to: ["person@example.com"],
      subject: "Preview",
      body: "Preview body",
    },
    connectionId: 12,
  });
});

test("clawlink_list_tools requires an integration slug", async () => {
  const api = createFakeApi();
  clawlinkPlugin.register(api);
  const tool = api.getTool("clawlink_list_tools");

  await assert.rejects(
    () => tool.execute("test", {}),
    /integration is required/,
  );
});

test("clawlink_list_tools lists compact tools for one integration", async () => {
  const api = createFakeApi();
  clawlinkPlugin.register(api);
  const tool = api.getTool("clawlink_list_tools");
  let capturedRequest = null;

  await withFetchMock(async (url, options) => {
    capturedRequest = {
      url,
      method: options.method,
    };

    return successResponse({
      tools: [
        {
          integration: "youtube",
          name: "youtube_list_user_playlists",
          description: "List playlists owned by the authenticated YouTube user.",
          inputSchema: {
            type: "object",
            properties: {
              pageToken: { type: "string" },
            },
          },
          mode: "read",
          accessLevel: "read",
          risk: "low",
          guidanceAvailable: false,
          requiresConfirmation: false,
          previewAvailable: true,
          defaultConnectionId: 23,
          connectionCount: 1,
        },
      ],
      count: 1,
      integration: "youtube",
    });
  }, async () => {
    const result = await tool.execute("test", { integration: " YouTube " });

    assert.match(result.content[0].text, /Available ClawLink tools for youtube:/);
    assert.match(result.content[0].text, /youtube_list_user_playlists/);
    assert.match(result.content[0].text, /inputSchema/);
    assert.match(result.content[0].text, /pageToken/);
    assert.match(result.content[0].text, /clawlink_describe_tool/);
  });

  assert.deepEqual(capturedRequest, {
    url: "https://claw-link.dev/api/tools?integration=youtube",
    method: "GET",
  });
});

test("clawlink_search_tools searches compact tools with integration and limit", async () => {
  const api = createFakeApi();
  clawlinkPlugin.register(api);
  const tool = api.getTool("clawlink_search_tools");
  let capturedRequest = null;

  await withFetchMock(async (url, options) => {
    capturedRequest = {
      url,
      method: options.method,
    };

    return successResponse({
      tools: [
        {
          integration: "youtube",
          name: "youtube_list_user_playlists",
          description: "List playlists owned by the authenticated YouTube user.",
          inputSchema: {
            type: "object",
            properties: {
              pageToken: { type: "string" },
            },
          },
          mode: "read",
          accessLevel: "read",
          risk: "low",
          guidanceAvailable: true,
          requiresConfirmation: false,
          previewAvailable: true,
          defaultConnectionId: 23,
          connectionCount: 1,
        },
      ],
      count: 1,
      query: "playlist",
      integration: "youtube",
    });
  }, async () => {
    const result = await tool.execute("test", {
      query: "playlist",
      integration: " YouTube ",
      limit: 7,
    });

    assert.match(result.content[0].text, /Matching ClawLink tools for youtube and "playlist":/);
    assert.match(result.content[0].text, /youtube_list_user_playlists/);
    assert.match(result.content[0].text, /inputSchema/);
    assert.match(result.content[0].text, /pageToken/);
  });

  assert.deepEqual(capturedRequest, {
    url: "https://claw-link.dev/api/tools/search?query=playlist&integration=youtube&limit=7",
    method: "GET",
  });
});

test("clawlink_list_tools flags unhydrated schemas instead of rendering the bare stub", async () => {
  const api = createFakeApi();
  clawlinkPlugin.register(api);
  const tool = api.getTool("clawlink_list_tools");

  await withFetchMock(async () => {
    return successResponse({
      tools: [
        {
          integration: "airtable",
          name: "airtable_list_records",
          description: "List records from an Airtable table.",
          inputSchema: {},
          schemaHydrated: false,
          mode: "read",
          accessLevel: "read",
          risk: "low",
          guidanceAvailable: false,
          requiresConfirmation: false,
          previewAvailable: true,
          defaultConnectionId: 1,
          connectionCount: 1,
        },
        {
          integration: "airtable",
          name: "airtable_list_bases",
          description: "List Airtable bases.",
          inputSchema: {
            type: "object",
            properties: { offset: { type: "string" } },
          },
          schemaHydrated: true,
          mode: "read",
          accessLevel: "read",
          risk: "low",
          guidanceAvailable: false,
          requiresConfirmation: false,
          previewAvailable: true,
          defaultConnectionId: 1,
          connectionCount: 1,
        },
      ],
      count: 2,
      integration: "airtable",
    });
  }, async () => {
    const result = await tool.execute("test", { integration: "airtable" });
    const text = result.content[0].text;

    // Unhydrated tool: the empty stub must not render as a real schema.
    assert.match(text, /NOT LOADED — call clawlink_describe_tool/);
    assert.doesNotMatch(text, /"inputSchema": \{\}/);
    // Hydrated tool renders its schema untouched; servers that predate the
    // schemaHydrated flag (undefined) must also render schemas untouched.
    assert.match(text, /offset/);
  });
});

test("clawlink_search_tools requires a query", async () => {
  const api = createFakeApi();
  clawlinkPlugin.register(api);
  const tool = api.getTool("clawlink_search_tools");

  await assert.rejects(
    () => tool.execute("test", { integration: "youtube" }),
    /query is required/,
  );
});

test("clawlink_get_result reads a stored result slice with selectors + opt-in header", async () => {
  const api = createFakeApi();
  clawlinkPlugin.register(api);
  const tool = api.getTool("clawlink_get_result");
  let capturedRequest = null;

  await withFetchMock(async (url, options) => {
    capturedRequest = {
      url,
      method: options.method,
      headers: options.headers,
    };

    return successResponse({
      execution_id: "exe_123",
      status: "succeeded",
      output: {
        path: "messages",
        total: 412,
        offset: 0,
        returned: 2,
        has_more: true,
        items: [
          { subject: "Hello", from: "a@example.com" },
          { subject: "World", from: "b@example.com" },
        ],
      },
    });
  }, async () => {
    const result = await tool.execute("test", {
      executionId: "exe_123",
      path: "messages",
      fields: ["subject", "from"],
      limit: 2,
    });

    assert.match(result.content[0].text, /ClawLink stored result: exe_123/);
    assert.match(result.content[0].text, /412/);
  });

  assert.equal(
    capturedRequest.url,
    "https://claw-link.dev/api/executions/exe_123?path=messages&fields=subject%2Cfrom&limit=2",
  );
  assert.equal(capturedRequest.method, "GET");
  assert.equal(capturedRequest.headers["x-clawlink-capabilities"], "offload");
});

test("clawlink_get_result requires an executionId", async () => {
  const api = createFakeApi();
  clawlinkPlugin.register(api);
  const tool = api.getTool("clawlink_get_result");

  await assert.rejects(
    () => tool.execute("test", { path: "messages" }),
    /executionId is required/,
  );
});

test("clawlink_call_tool surfaces generic structured validation errors", async () => {
  const api = createFakeApi();
  clawlinkPlugin.register(api);
  const tool = api.getTool("clawlink_call_tool");

  await withFetchMock(async () => new Response(JSON.stringify({
    ok: false,
    error: {
      type: "validation",
      code: "invalid_arguments",
      message: "arguments.required_field is required",
      retryable: false,
    },
    missingFields: ["required_field", "message_body"],
    invalidFields: [],
    hint: "Retry example_create_item with arguments that match the inputSchema.",
    inputSchema: {
      type: "object",
      required: ["required_field", "message_body"],
      properties: {
        required_field: { type: "string" },
        message_body: { type: "string" },
      },
    },
    details: [
      "arguments.required_field is required",
      "arguments.message_body is required",
    ],
  }), {
    status: 400,
    headers: {
      "Content-Type": "application/json",
    },
  }), async () => {
    const result = await tool.execute("test", {
      tool: "example_create_item",
      arguments: {
        content: "Hello from ClawLink!",
      },
    });

    assert.match(result.content[0].text, /ClawLink tool failed: example_create_item/);
    assert.match(result.content[0].text, /Missing fields: required_field, message_body/);
    assert.match(result.content[0].text, /Input schema:/);
    assert.equal(result.details.missingFields[0], "required_field");
    assert.equal(result.details.missingFields[1], "message_body");
  });
});

test("clawlink_begin_pairing hides the display code in the returned text", async () => {
  const api = createFakeApi({});
  clawlinkPlugin.register(api);
  const beginPairing = api.getTool("clawlink_begin_pairing");

  await withFetchMock(async (url) => {
    if (url === "https://claw-link.dev/api/openclaw/pair/start") {
      return successResponse({
        sessionToken: "pair_sess_122",
        displayCode: "ABCD1234",
        deviceLabel: "OpenClaw device",
        status: "awaiting_browser",
        pairUrl: "https://claw-link.dev/openclaw/pair/pair_sess_122",
        expiresAt: "2099-05-01T01:10:00.000Z",
        verifier: "pair_verifier_122",
        pollIntervalMs: 3000,
      });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  }, async () => {
    const result = await beginPairing.execute("test", {});

    assert.match(result.content[0].text, /ClawLink browser pairing started\./);
    assert.match(result.content[0].text, /https:\/\/claw-link\.dev\/openclaw\/pair\/pair_sess_122/);
    assert.match(result.content[0].text, /send `done`/);
    assert.doesNotMatch(result.content[0].text, /ABCD1234|displayCode|Pairing code/);
    assert.equal(result.details.displayCode, "ABCD1234");
  });
});

test("clawlink_begin_pairing returns immediately and asks the user to send done after approval", async () => {
  const api = createFakeApi({});
  clawlinkPlugin.register(api);
  const beginPairing = api.getTool("clawlink_begin_pairing");
  const updates = [];

  await withFetchMock(async (url) => {
    if (url === "https://claw-link.dev/api/openclaw/pair/start") {
      return successResponse({
        sessionToken: "pair_sess_125",
        displayCode: "LMNO5678",
        deviceLabel: "Steve's MacBook",
        status: "awaiting_browser",
        pairUrl: "https://claw-link.dev/openclaw/pair/pair_sess_125",
        expiresAt: "2099-05-01T01:25:00.000Z",
        verifier: "pair_verifier_125",
        pollIntervalMs: 0,
      });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  }, async () => {
    const result = await beginPairing.execute(
      "test",
      { deviceLabel: "Steve's MacBook" },
      undefined,
      (partial) => {
        updates.push(partial);
      },
    );

    assert.equal(result.details.sessionToken, "pair_sess_125");
    assert.equal(result.details.status, "awaiting_browser");
    assert.match(result.content[0].text, /send `done`/);
    assert.match(result.content[0].text, /https:\/\/claw-link\.dev\/openclaw\/pair\/pair_sess_125/);
    assert.doesNotMatch(result.content[0].text, /LMNO5678|displayCode|Pairing code/);
    assert.deepEqual(updates, []);
  });

  assert.deepEqual(api.getPluginConfig(), {
    pendingPairing: {
      sessionToken: "pair_sess_125",
      verifier: "pair_verifier_125",
      pairUrl: "https://claw-link.dev/openclaw/pair/pair_sess_125",
      displayCode: "LMNO5678",
      deviceLabel: "Steve's MacBook",
      expiresAt: "2099-05-01T01:25:00.000Z",
    },
  });
});

test("clawlink_get_pairing_status exchanges the approved session and clears pending pairing after finalize", async () => {
  const api = createFakeApi({});
  clawlinkPlugin.register(api);
  const beginPairing = api.getTool("clawlink_begin_pairing");
  const getPairingStatus = api.getTool("clawlink_get_pairing_status");
  const requests = [];

  await withFetchMock(async (url, options = {}) => {
    requests.push({
      url,
      method: options.method ?? "GET",
      headers: options.headers ?? {},
      body: options.body ? JSON.parse(options.body) : null,
    });

    if (url === "https://claw-link.dev/api/openclaw/pair/start") {
      return successResponse({
        sessionToken: "pair_sess_123",
        displayCode: "ABCD1234",
        deviceLabel: "Steve's MacBook",
        status: "awaiting_browser",
        pairUrl: "https://claw-link.dev/openclaw/pair/pair_sess_123",
        expiresAt: "2099-05-01T01:15:00.000Z",
        verifier: "pair_verifier_123",
        pollIntervalMs: 3000,
      });
    }

    if (url === "https://claw-link.dev/api/openclaw/pair/sessions/pair_sess_123") {
      return successResponse({
        session: {
          token: "pair_sess_123",
          displayCode: "ABCD1234",
          deviceLabel: "Steve's MacBook",
          status: "ready_for_device",
          expiresAt: "2099-05-01T01:15:00.000Z",
          approvedAt: "2026-05-01T01:02:00.000Z",
          pairedAt: null,
        },
      });
    }

    if (url === "https://claw-link.dev/api/openclaw/pair/sessions/pair_sess_123/exchange") {
      return successResponse({
        session: {
          token: "pair_sess_123",
          displayCode: "ABCD1234",
          deviceLabel: "Steve's MacBook",
          status: "awaiting_local_save",
          expiresAt: "2099-05-01T01:15:00.000Z",
          approvedAt: "2026-05-01T01:02:00.000Z",
          pairedAt: null,
        },
        apiKey: "cllk_test_paired_123",
        apiKeyId: 41,
      });
    }

    if (url === "https://claw-link.dev/api/openclaw/pair/sessions/pair_sess_123/finalize") {
      return successResponse({
        session: {
          token: "pair_sess_123",
          displayCode: "ABCD1234",
          deviceLabel: "Steve's MacBook",
          status: "paired",
          expiresAt: "2099-05-01T01:15:00.000Z",
          approvedAt: "2026-05-01T01:02:00.000Z",
          pairedAt: "2026-05-01T01:03:00.000Z",
        },
      });
    }

    if (url === "https://claw-link.dev/api/integrations") {
      return successResponse({
        integrations: [
          {
            id: 7,
            integration: "gmail",
            isDefault: true,
            connectionLabel: "Work",
            accountLabel: "steve@example.com",
          },
        ],
      });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  }, async () => {
    await beginPairing.execute("test", { deviceLabel: "Steve's MacBook" });
    const result = await getPairingStatus.execute("test", {});

    assert.equal(result.details.session.status, "paired");
    assert.deepEqual(result.details.integrations, [
      {
        id: 7,
        integration: "gmail",
        isDefault: true,
        connectionLabel: "Work",
        accountLabel: "steve@example.com",
      },
    ]);
  });

  assert.deepEqual(api.getPluginConfig(), {
    apiKey: "cllk_test_paired_123",
  });

  const integrationRequest = requests.find(
    (request) => request.url === "https://claw-link.dev/api/integrations",
  );
  assert.equal(integrationRequest?.headers["X-ClawLink-API-Key"], "cllk_test_paired_123");
});

test("clawlink_get_pairing_status preserves pending pairing when finalize fails", async () => {
  const api = createFakeApi({});
  clawlinkPlugin.register(api);
  const beginPairing = api.getTool("clawlink_begin_pairing");
  const getPairingStatus = api.getTool("clawlink_get_pairing_status");

  await withFetchMock(async (url) => {
    if (url === "https://claw-link.dev/api/openclaw/pair/start") {
      return successResponse({
        sessionToken: "pair_sess_124",
        displayCode: "ZXCV5678",
        deviceLabel: "OpenClaw device",
        status: "awaiting_browser",
        pairUrl: "https://claw-link.dev/openclaw/pair/pair_sess_124",
        expiresAt: "2099-05-01T01:20:00.000Z",
        verifier: "pair_verifier_124",
        pollIntervalMs: 3000,
      });
    }

    if (url === "https://claw-link.dev/api/openclaw/pair/sessions/pair_sess_124") {
      return successResponse({
        session: {
          token: "pair_sess_124",
          displayCode: "ZXCV5678",
          deviceLabel: "OpenClaw device",
          status: "ready_for_device",
          expiresAt: "2099-05-01T01:20:00.000Z",
          approvedAt: "2026-05-01T01:04:00.000Z",
          pairedAt: null,
        },
      });
    }

    if (url === "https://claw-link.dev/api/openclaw/pair/sessions/pair_sess_124/exchange") {
      return successResponse({
        session: {
          token: "pair_sess_124",
          displayCode: "ZXCV5678",
          deviceLabel: "OpenClaw device",
          status: "awaiting_local_save",
          expiresAt: "2099-05-01T01:20:00.000Z",
          approvedAt: "2026-05-01T01:04:00.000Z",
          pairedAt: null,
        },
        apiKey: "cllk_test_paired_124",
        apiKeyId: 42,
      });
    }

    if (url === "https://claw-link.dev/api/openclaw/pair/sessions/pair_sess_124/finalize") {
      return new Response(JSON.stringify({ error: "transient failure" }), {
        status: 500,
        headers: {
          "Content-Type": "application/json",
        },
      });
    }

    if (url === "https://claw-link.dev/api/integrations") {
      return successResponse({ integrations: [] });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  }, async () => {
    await beginPairing.execute("test", {});
    const result = await getPairingStatus.execute("test", {});

    assert.equal(result.details.session.status, "awaiting_local_save");
  });

  assert.deepEqual(api.getPluginConfig(), {
    apiKey: "cllk_test_paired_124",
    pendingPairing: {
      sessionToken: "pair_sess_124",
      verifier: "pair_verifier_124",
      pairUrl: "https://claw-link.dev/openclaw/pair/pair_sess_124",
      displayCode: "ZXCV5678",
      deviceLabel: "OpenClaw device",
      expiresAt: "2099-05-01T01:20:00.000Z",
    },
  });
});

function pinnedApi() {
  // An OpenClaw snapshot that never refreshes: the reload after our config write failed.
  const api = createFakeApi({});
  const pinned = api.runtime.config.loadConfig();
  api.runtime.config.loadConfig = () => structuredClone(pinned);
  return api;
}

function pairingFetchMock(token) {
  const session = (status) => ({ session: { token, status, expiresAt: "2099-05-01T01:15:00.000Z" } });
  return async (url) => {
    if (url === "https://claw-link.dev/api/openclaw/pair/start") {
      return successResponse({
        sessionToken: token,
        displayCode: "ABCD1236",
        deviceLabel: "hetzner3",
        status: "awaiting_browser",
        pairUrl: `https://claw-link.dev/openclaw/pair/${token}`,
        expiresAt: "2099-05-01T01:15:00.000Z",
        verifier: `verifier_${token}`,
        pollIntervalMs: 3000,
      });
    }
    if (url === `https://claw-link.dev/api/openclaw/pair/sessions/${token}`) return successResponse(session("ready_for_device"));
    if (url === `https://claw-link.dev/api/openclaw/pair/sessions/${token}/exchange`) {
      return successResponse({ ...session("awaiting_local_save"), apiKey: `cllk_test_${token}`, apiKeyId: 44 });
    }
    if (url === `https://claw-link.dev/api/openclaw/pair/sessions/${token}/finalize`) return successResponse(session("paired"));
    if (url === "https://claw-link.dev/api/integrations") return successResponse({ integrations: [] });
    throw new Error(`Unexpected fetch: ${url}`);
  };
}

test("a pairing started by one copy of the plugin is finished by another copy (chat vs tools.invoke)", async () => {
  // hetzner3, 2026-09-27: the Gateway loads the module twice; chat tools ran in one copy and
  // `openclaw gateway call tools.invoke` in the other, which said "No ClawLink pairing session".
  const chatCopy = pinnedApi();
  const rpcCopy = pinnedApi();
  clawlinkPlugin.register(chatCopy);
  clawlinkPlugin.register(rpcCopy);

  await withFetchMock(pairingFetchMock("pair_sess_127"), async () => {
    await chatCopy.getTool("clawlink_begin_pairing").execute("test", {});
    const status = await rpcCopy.getTool("clawlink_get_pairing_status").execute("test", {});
    assert.equal(status.details.session.status, "paired");
    await chatCopy.getTool("clawlink_list_integrations").execute("test", {});
  });
});

test("a new plugin generation (reinstall) trusts its fresh config, not the old pairing in memory", async () => {
  const api = pinnedApi();
  clawlinkPlugin.register(api);
  await withFetchMock(pairingFetchMock("pair_sess_128"), async () => {
    await api.getTool("clawlink_begin_pairing").execute("test", {});
    await api.getTool("clawlink_get_pairing_status").execute("test", {});
  });

  // Uninstall + reinstall: OpenClaw registers a new copy whose config has no key.
  const reinstalled = createFakeApi({});
  clawlinkPlugin.register(reinstalled);
  await assert.rejects(() => reinstalled.getTool("clawlink_list_integrations").execute("test", {}), /not paired yet/);
});

test("a masked key in the config counts as not paired instead of being sent", async () => {
  for (const masked of ["cllk_live_***", "__OPENCLAW_REDACTED__"]) {
    const api = createFakeApi({ apiKey: masked });
    clawlinkPlugin.register(api);
    await withFetchMock(async (url) => {
      throw new Error(`No request expected, got ${url}`);
    }, async () => {
      await assert.rejects(() => api.getTool("clawlink_list_integrations").execute("test", {}), /not paired yet/);
    });
  }
});

test("/clawlink logout also forgets a pending pairing held in memory", async () => {
  const api = pinnedApi();
  clawlinkPlugin.register(api);
  await withFetchMock(pairingFetchMock("pair_sess_129"), async () => {
    await api.getTool("clawlink_begin_pairing").execute("test", {});
  });
  await api.getCommand("clawlink").handler({ args: "logout" });
  const status = await api.getCommand("clawlink").handler({ args: "status" });
  assert.match(status.text, /pairing: idle/);
});

test("pairing finishes when the config reload after begin_pairing fails and the snapshot never sees the pending session", async () => {
  // OpenClaw 2026.9.6 on hetzner3 (2026-09-27): the reload after begin_pairing's config write
  // failed with "still has active retained work", so loadConfig() kept the pre-pairing snapshot
  // and get_pairing_status answered "No ClawLink pairing session is in progress" until a restart.
  const api = createFakeApi({});
  const pinnedSnapshot = api.runtime.config.loadConfig();
  api.runtime.config.loadConfig = () => structuredClone(pinnedSnapshot);
  clawlinkPlugin.register(api);
  const beginPairing = api.getTool("clawlink_begin_pairing");
  const getPairingStatus = api.getTool("clawlink_get_pairing_status");

  await withFetchMock(async (url) => {
    if (url === "https://claw-link.dev/api/openclaw/pair/start") {
      return successResponse({
        sessionToken: "pair_sess_126",
        displayCode: "ABCD1235",
        deviceLabel: "hetzner3",
        status: "awaiting_browser",
        pairUrl: "https://claw-link.dev/openclaw/pair/pair_sess_126",
        expiresAt: "2099-05-01T01:15:00.000Z",
        verifier: "pair_verifier_126",
        pollIntervalMs: 3000,
      });
    }
    if (url === "https://claw-link.dev/api/openclaw/pair/sessions/pair_sess_126") {
      return successResponse({
        session: { token: "pair_sess_126", status: "ready_for_device", expiresAt: "2099-05-01T01:15:00.000Z" },
      });
    }
    if (url === "https://claw-link.dev/api/openclaw/pair/sessions/pair_sess_126/exchange") {
      return successResponse({
        session: { token: "pair_sess_126", status: "awaiting_local_save", expiresAt: "2099-05-01T01:15:00.000Z" },
        apiKey: "cllk_test_paired_126",
        apiKeyId: 43,
      });
    }
    if (url === "https://claw-link.dev/api/openclaw/pair/sessions/pair_sess_126/finalize") {
      return successResponse({
        session: { token: "pair_sess_126", status: "paired", expiresAt: "2099-05-01T01:15:00.000Z" },
      });
    }
    if (url === "https://claw-link.dev/api/integrations") {
      return successResponse({ integrations: [] });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }, async () => {
    await beginPairing.execute("test", { deviceLabel: "hetzner3" });
    assert.equal(pinnedSnapshot.plugins?.entries?.["clawlink-plugin"]?.config?.pendingPairing, undefined);

    const status = await getPairingStatus.execute("test", {});
    assert.equal(status.details.session.status, "paired");

    // A second begin_pairing must not resurrect the finished session from memory.
    const again = await beginPairing.execute("test", {});
    assert.equal(again.details.configured, true);
  });
});

test("tools keep working right after pairing while OpenClaw still serves the pre-pairing config snapshot", async () => {
  // OpenClaw's loadConfig() returns a pinned in-memory snapshot that refreshes later,
  // so a read right after writeConfigFile still has no apiKey.
  const api = createFakeApi({});
  const liveLoadConfig = api.runtime.config.loadConfig;
  let pinnedSnapshot = null;
  api.runtime.config.loadConfig = () => (pinnedSnapshot ? structuredClone(pinnedSnapshot) : liveLoadConfig());
  clawlinkPlugin.register(api);
  const beginPairing = api.getTool("clawlink_begin_pairing");
  const getPairingStatus = api.getTool("clawlink_get_pairing_status");
  const listIntegrations = api.getTool("clawlink_list_integrations");
  const command = api.getCommand("clawlink");
  const integrationKeys = [];

  await withFetchMock(async (url, options = {}) => {
    if (url === "https://claw-link.dev/api/openclaw/pair/start") {
      return successResponse({
        sessionToken: "pair_sess_125",
        displayCode: "ABCD1234",
        deviceLabel: "Steve's MacBook",
        status: "awaiting_browser",
        pairUrl: "https://claw-link.dev/openclaw/pair/pair_sess_125",
        expiresAt: "2099-05-01T01:15:00.000Z",
        verifier: "pair_verifier_125",
        pollIntervalMs: 3000,
      });
    }

    if (url === "https://claw-link.dev/api/openclaw/pair/sessions/pair_sess_125") {
      return successResponse({
        session: { token: "pair_sess_125", status: "ready_for_device", expiresAt: "2099-05-01T01:15:00.000Z" },
      });
    }

    if (url === "https://claw-link.dev/api/openclaw/pair/sessions/pair_sess_125/exchange") {
      return successResponse({
        session: { token: "pair_sess_125", status: "awaiting_local_save", expiresAt: "2099-05-01T01:15:00.000Z" },
        apiKey: "cllk_test_paired_125",
        apiKeyId: 42,
      });
    }

    if (url === "https://claw-link.dev/api/openclaw/pair/sessions/pair_sess_125/finalize") {
      return successResponse({
        session: { token: "pair_sess_125", status: "paired", expiresAt: "2099-05-01T01:15:00.000Z" },
      });
    }

    if (url === "https://claw-link.dev/api/integrations") {
      integrationKeys.push(options.headers["X-ClawLink-API-Key"]);
      return successResponse({
        integrations: [{ id: 9, integration: "gmail", isDefault: true }],
      });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  }, async () => {
    await beginPairing.execute("test", { deviceLabel: "Steve's MacBook" });
    // The user is away in the browser; the snapshot has caught up with the pending marker.
    // From here on it is pinned, so the key written by the exchange is invisible to loadConfig().
    pinnedSnapshot = liveLoadConfig();
    const status = await getPairingStatus.execute("test", {});
    assert.equal(status.details.session.status, "paired");
    assert.equal(status.details.integrations.length, 1);

    const listed = await listIntegrations.execute("test", {});
    assert.match(listed.content[0].text, /gmail/);
    assert.deepEqual(integrationKeys, ["cllk_test_paired_125", "cllk_test_paired_125"]);

    // The pending marker is cleared even though the fake writeConfigFile replaces the file
    // wholesale (real OpenClaw merge-patches the change onto the file, so the key survives there).
    assert.equal(api.getPluginConfig().pendingPairing, undefined);

    await command.handler({ args: "logout" });
    await assert.rejects(() => listIntegrations.execute("test", {}), /not paired yet/);
  });
});
