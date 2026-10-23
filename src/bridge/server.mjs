import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { CodexCdpClient } from "./codex-cdp.mjs";
import { decodeThreadPathSegment } from "./thread-key.mjs";

const execFileAsync = promisify(execFile);
const HOST = "127.0.0.1";
const PORT = Number(process.env.CODEX_KEYBOARD_PORT || 17373);
const configuredRefreshMs = Number(process.env.CODEX_KEYBOARD_REFRESH_MS || 500);
const REFRESH_MS = Number.isFinite(configuredRefreshMs)
  ? Math.max(250, configuredRefreshMs)
  : 500;
const client = new CodexCdpClient();
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
let composerRevision = 0;

async function focusCodex() {
  await execFileAsync("/usr/bin/open", ["-b", "com.openai.codex"], {
    timeout: 3000
  });
}

async function refresh(force = false) {
  if (refreshPromise) return refreshPromise;
  if (!force && Date.now() < nextReconnectAt) return;
  refreshPromise = (async () => {
    try {
      const revision = composerRevision;
      const snapshot = await client.snapshot();
      // A snapshot started before a selection can finish after it. Preserve
      // the acknowledged composer while still refreshing tasks and usage.
      if (revision !== composerRevision) snapshot.composer = cached.composer;
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
  if (request.method === "GET" && url.pathname === "/health") {
    await refresh(true);
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
    /^\/action\/(fast|approve|reject|pin|new|fork|mic|steer|submit)\/(down|up)$/
  );
  const selection = request.method === "POST" && url.pathname.match(
    /^\/composer\/(model|reasoning)\/(left|right)$/
  );
  const contextMenu = request.method === "POST" && url.pathname.match(
    /^\/composer\/context\/(up|down|select|close)$/
  );
  const permission = request.method === "POST" && url.pathname.match(
    /^\/permissions\/(policy\/(left|right)|approval\/(once|session|deny)|confirm|cancel)$/
  );
  if (permission) {
    try {
      const contextKey = url.searchParams.get("context");
      if (!contextKey || contextKey.length > 2048) throw new Error("Missing permission context");
      const command = ["confirm", "cancel"].includes(permission[1]) ?
        { kind: permission[1], contextKey, confirmationKey: url.searchParams.get("request") } :
        permission[2] ? { kind: "policy", direction: permission[2], contextKey } :
        { kind: "approval", decision: permission[3], contextKey, requestKey: url.searchParams.get("request") };
      const permissions = await client.controlPermissions(command);
      return json(response, 200, { ok: true, permissions });
    } catch (error) {
      return json(response, 503, { ok: false, error: error.message });
    }
  }
  if (contextMenu) {
    try {
      if (["up", "down"].includes(contextMenu[1])) await focusCodex();
      const result = await client.navigateContextMenu(contextMenu[1]);
      return json(response, 200, { ok: true, ...result });
    } catch (error) {
      return json(response, 503, { ok: false, error: error.message });
    }
  }
  if (selection) {
    try {
      const composer = await client.adjustComposerSetting(selection[1], selection[2]);
      composerRevision += 1;
      cached = { ...cached, composer, updatedAt: Date.now() };
      return json(response, 200, { ok: true, composer });
    } catch (error) {
      return json(response, 503, { ok: false, error: error.message });
    }
  }
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
