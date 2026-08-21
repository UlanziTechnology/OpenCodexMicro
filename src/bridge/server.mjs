import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { CodexCdpClient } from "./codex-cdp.mjs";
import { bridgeRequestAuthorized } from "./auth.mjs";
import { focusCodex } from "./platform.mjs";
import { decodeThreadPathSegment } from "./thread-key.mjs";

const HOST = "127.0.0.1";
const PORT = Number(process.env.CODEX_KEYBOARD_PORT || 17373);
const configuredRefreshMs = Number(process.env.CODEX_KEYBOARD_REFRESH_MS || 500);
const REFRESH_MS = Number.isFinite(configuredRefreshMs)
  ? Math.max(250, configuredRefreshMs)
  : 500;
const client = new CodexCdpClient();
const dataRoot = process.env.CODEX_BRIDGE_DATA_ROOT || (process.platform === "win32"
  ? join(process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"), "OpenCodexMicro")
  : join(homedir(), "Library", "Application Support", "OpenCodexMicro"));
const bridgeToken = process.env.CODEX_BRIDGE_TOKEN || (() => {
  try { return readFileSync(join(dataRoot, "bridge-token"), "utf8").trim(); }
  catch { return ""; }
})();
let cached = {
  connected: false,
  slots: Array.from({ length: 6 }, (_, id) => ({
    id, threadKey: null, title: null, status: "off", selected: false
  })),
  error: "Waiting for Codex",
  updatedAt: Date.now()
};
let refreshPromise = null;
let nextReconnectAt = 0;
let hasRefreshed = false;

function authorized(request) {
  return bridgeRequestAuthorized(bridgeToken, request.headers.authorization);
}

async function refresh(force = false) {
  if (refreshPromise) return refreshPromise;
  if (!force && Date.now() < nextReconnectAt) return;
  refreshPromise = (async () => {
    try {
      const snapshot = await client.snapshot();
      cached = { connected: true, ...snapshot, error: null, updatedAt: Date.now() };
      nextReconnectAt = 0;
    } catch (error) {
      cached = { ...cached, connected: false, error: error.message, updatedAt: Date.now() };
      nextReconnectAt = Date.now() + 2000;
    }
  })();
  try {
    await refreshPromise;
  } finally {
    hasRefreshed = true;
    refreshPromise = null;
  }
}

function json(response, status, body) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "http://127.0.0.1"
  });
  response.end(`${JSON.stringify(body)}\n`);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url || "/", `http://${HOST}:${PORT}`);
  if (request.method === "POST" && !authorized(request)) {
    return json(response, 401, { ok: false, error: "Bridge authorization required" });
  }
  if (request.method === "GET" && url.pathname === "/health") {
    if (!hasRefreshed || Date.now() - cached.updatedAt >= REFRESH_MS * 2) {
      await refresh(true);
    }
    return json(response, 200, { ok: true, codexConnected: cached.connected, updatedAt: cached.updatedAt });
  }
  if (request.method === "GET" && url.pathname === "/state") {
    return json(response, 200, cached);
  }
  if (request.method === "POST" && url.pathname === "/focus") {
    try {
       await focusCodex();
      return json(response, 200, { ok: true });
    } catch (error) {
      return json(response, 503, { ok: false, error: error.message });
    }
  }
  const match = request.method === "POST" && url.pathname.match(/^\/agent\/([0-5])\/click$/);
  if (match) {
    try {
      await Promise.all([
        client.clickAgent(Number(match[1])),
        focusCodex()
      ]);
      return json(response, 200, { ok: true });
    } catch (error) {
      return json(response, 503, { ok: false, error: error.message });
    }
  }
  const threadMatch = request.method === "POST" && url.pathname.match(
    /^\/thread\/([^/]+)\/click$/
  );
  if (threadMatch) {
    try {
      const threadId = decodeThreadPathSegment(threadMatch[1]);
      const slot = Number(url.searchParams.get("slot") || 0);
      if (!Number.isInteger(slot) || slot < 0 || slot > 5) {
        throw new Error("Invalid Codex Micro slot");
      }
      await Promise.all([
        client.clickThread(threadId, slot),
        focusCodex()
      ]);
      return json(response, 200, { ok: true, bridge: true });
    } catch (error) {
      return json(response, 503, {
        ok: false,
        bridge: false,
        error: error.message
      });
    }
  }
  const action = request.method === "POST" && url.pathname.match(
    /^\/action\/(fast|approve|reject|pin|new|fork|mic|steer|submit|model-sol-high|model-luna-max|model-sol-medium)\/(down|up)$/
  );
  if (action) {
    try {
      if (action[1] === "steer") {
        if (action[2] === "down") {
          await focusCodex();
          await client.dispatchComposerSteer();
        }
        return json(response, 200, { ok: true });
      }
      await client.dispatchNamedAction(action[1], action[2] === "down");
      return json(response, 200, { ok: true, bridge: true });
    } catch (error) {
      return json(response, 503, { ok: false, error: error.message });
    }
  }
  const joystick = request.method === "POST" && url.pathname.match(
    /^\/joystick\/(up|right|down|left)\/(down|up)$/
  );
  if (joystick) {
    try {
      await client.dispatchJoystick(joystick[1], joystick[2] === "down" ? 1 : 0);
      return json(response, 200, { ok: true });
    } catch (error) {
      return json(response, 503, { ok: false, error: error.message });
    }
  }
  return json(response, 404, { ok: false, error: "Not found" });
});

server.listen(PORT, HOST, () => {
  console.log(`Codex Keyboard bridge listening on http://${HOST}:${PORT}`);
  void refresh();
});

const timer = setInterval(() => void refresh(), REFRESH_MS);
timer.unref();

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    clearInterval(timer);
    client.disconnect();
    server.close(() => process.exit(0));
  });
}
