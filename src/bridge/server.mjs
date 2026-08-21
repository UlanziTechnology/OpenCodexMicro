import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { CodexCdpClient } from "./codex-cdp.mjs";
import { bridgeRequestAuthorized } from "./auth.mjs";
import { focusCodex } from "./platform.mjs";
import { navigateAndFocus } from "./navigation.mjs";
import { decodeThreadPathSegment } from "./thread-key.mjs";

const HOST = "127.0.0.1";
const PORT = Number(process.env.CODEX_KEYBOARD_PORT || 17373);
const BRIDGE_VERSION = typeof __CODEX_BRIDGE_VERSION__ === "undefined"
  ? null
  : __CODEX_BRIDGE_VERSION__;
const RUNTIME_HASH = (() => {
  try {
    return createHash("sha256").update(readFileSync(process.argv[1])).digest("hex");
  } catch {
    return null;
  }
})();
const NATIVE_RUNTIME_HASH = /^[a-f0-9]{64}$/.test(String(process.env.CODEX_BRIDGE_NATIVE_HASH || ""))
  ? process.env.CODEX_BRIDGE_NATIVE_HASH
  : null;
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
const traceBuffer = new Map();
const TRACE_TTL_MS = 30000;
const TRACE_LIMIT = 32;
const TRACE_EVENT_LIMIT = 160;

function diagnosticErrorCategory(error) {
  const name = String(error?.name || "").toLowerCase();
  const message = String(error?.message || "").toLowerCase();
  if (name.includes("timeout") || message.includes("timed out") || message.includes("timeout")) return "timeout";
  if (message.includes("disconnected") || message.includes("not running")) return "cdp-unavailable";
  if (message.includes("window")) return "focus-failed";
  if (message.includes("menu") || message.includes("model") || message.includes("reasoning")) return "renderer-state";
  return "bridge-operation";
}

function traceIdFrom(request) {
  const value = String(request.headers["x-codex-trace-id"] || "");
  return /^[a-f0-9-]{36}$/.test(value) ? value : null;
}

function safeTraceFields(fields) {
  return Object.fromEntries(Object.entries(fields || {}).flatMap(([key, value]) => {
    if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) {
      return [[key, value]];
    }
    const normalized = String(value || "");
    return /^[a-zA-Z0-9_.:-]{1,80}$/.test(normalized) ? [[key, normalized]] : [];
  }));
}

function startTrace(request, route, fields = {}) {
  const traceId = traceIdFrom(request);
  if (!traceId) return null;
  const startedAt = performance.now();
  const trace = {
    traceId,
    startedAt,
    events: [],
    pending: 0,
    completionRequested: false,
    complete: false,
    record(event, details = {}) {
      if (!/^[a-z0-9.-]{1,80}$/.test(event) || this.events.length >= TRACE_EVENT_LIMIT) return;
      this.events.push({
        event,
        offsetMs: Math.round(performance.now() - startedAt),
        ...safeTraceFields(details)
      });
    },
    defer() {
      this.pending += 1;
      let settled = false;
      return () => {
        if (settled) return;
        settled = true;
        this.pending = Math.max(0, this.pending - 1);
        if (this.completionRequested && this.pending === 0) this.complete = true;
      };
    },
    finish() {
      this.completionRequested = true;
      if (this.pending === 0) this.complete = true;
    }
  };
  trace.record("server.request", { route, ...fields });
  traceBuffer.set(traceId, trace);
  while (traceBuffer.size > TRACE_LIMIT) traceBuffer.delete(traceBuffer.keys().next().value);
  const cleanup = setTimeout(() => traceBuffer.delete(traceId), TRACE_TTL_MS);
  cleanup.unref?.();
  return trace;
}

function traceSnapshot(traceId) {
  const trace = traceBuffer.get(traceId);
  if (!trace) return null;
  return {
    traceId,
    complete: trace.complete,
    events: trace.events.map(event => ({ ...event }))
  };
}

async function focusCodexDesktop(trace = null) {
  const startedAt = performance.now();
  const path = process.platform === "win32" ? "win32-native" : "platform-adapter";
  trace?.record("focus.start", { platform: process.platform, path });
  try {
    let identity = null;
    if (process.platform === "win32") {
      const connection = client.socket?.readyState === 1 ? "reused" : "open";
      await client.connect();
      identity = client.connectionIdentity;
      trace?.record("focus.target", {
        connection,
        channel: identity?.channel || "unknown",
        outcome: "succeeded"
      });
    }
    const result = await focusCodex({ processId: identity?.processId ?? null });
    trace?.record("focus.native", {
      outcome: "succeeded",
      channel: identity?.channel || "unknown",
      reused: Boolean(result?.alreadyForeground && result?.alreadyMaximized)
    });
    trace?.record("focus.complete", {
      platform: process.platform,
      path,
      outcome: "succeeded",
      durationMs: Math.round(performance.now() - startedAt)
    });
    console.log("Codex Desktop window maximized and focused through the native desktop adapter");
  } catch (error) {
    trace?.record("focus.complete", {
      platform: process.platform,
      path,
      outcome: "failed",
      category: diagnosticErrorCategory(error),
      durationMs: Math.round(performance.now() - startedAt)
    });
    throw error;
  }
}

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
    return json(response, 200, {
      ok: true,
      bridgeVersion: BRIDGE_VERSION,
      runtimeHash: RUNTIME_HASH,
      nativeRuntimeHash: NATIVE_RUNTIME_HASH,
      codexConnected: cached.connected,
      updatedAt: cached.updatedAt
    });
  }
  if (request.method === "GET" && url.pathname === "/state") {
    return json(response, 200, cached);
  }
  if (request.method === "POST" && url.pathname === "/diagnostics/trace") {
    const traceId = traceIdFrom(request);
    const diagnostics = traceId ? traceSnapshot(traceId) : null;
    return json(response, diagnostics ? 200 : 404, diagnostics
      ? { ok: true, diagnostics }
      : { ok: false, error: "Trace diagnostics are unavailable" });
  }
  if (request.method === "POST" && url.pathname === "/focus") {
    try {
      await focusCodexDesktop();
      return json(response, 200, { ok: true });
    } catch (error) {
      return json(response, 503, { ok: false, error: error.message });
    }
  }
  const match = request.method === "POST" && url.pathname.match(/^\/agent\/([0-5])\/click$/);
  if (match) {
    try {
      const result = await navigateAndFocus(
        () => client.clickAgent(Number(match[1])),
        () => focusCodexDesktop()
      );
      return json(response, 200, { ok: true, ...result });
    } catch (error) {
      return json(response, 503, { ok: false, error: error.message });
    }
  }
  const threadMatch = request.method === "POST" && url.pathname.match(
    /^\/thread\/([^/]+)\/click$/
  );
  if (threadMatch) {
    let trace = null;
    try {
      const threadId = decodeThreadPathSegment(threadMatch[1]);
      const slot = Number(url.searchParams.get("slot") || 0);
      if (!Number.isInteger(slot) || slot < 0 || slot > 5) {
        throw new Error("Invalid Codex Micro slot");
      }
      trace = startTrace(request, "thread-click", { slot: slot + 1 });
      const result = await navigateAndFocus(
        () => client.clickThread(threadId, slot, trace),
        () => focusCodexDesktop(trace)
      );
      trace?.record("server.response", {
        outcome: "succeeded",
        route: "thread-click",
        focusOk: result.focusOk
      });
      return json(response, 200, { ok: true, bridge: true, ...result });
    } catch (error) {
      trace?.record("server.response", {
        outcome: "failed",
        route: "thread-click",
        category: diagnosticErrorCategory(error)
      });
      return json(response, 503, {
        ok: false,
        bridge: false,
        error: error.message
      });
    } finally {
      trace?.finish();
    }
  }
  const action = request.method === "POST" && url.pathname.match(
    /^\/action\/(fast|approve|reject|pin|new|fork|mic|steer|submit|model-sol-high|model-luna-max|model-sol-medium)\/(down|up)$/
  );
  if (action) {
    const trace = startTrace(request, "action", { action: action[1], phase: action[2] });
    try {
      if (action[1] === "steer") {
        if (action[2] === "down") {
          await focusCodexDesktop();
          await client.dispatchComposerSteer();
        }
        return json(response, 200, { ok: true });
      }
      await client.dispatchNamedAction(action[1], action[2] === "down", trace);
      trace?.record("server.response", { outcome: "succeeded", route: "action" });
      return json(response, 200, { ok: true, bridge: true });
    } catch (error) {
      trace?.record("server.response", {
        outcome: "failed",
        route: "action",
        category: diagnosticErrorCategory(error)
      });
      return json(response, 503, { ok: false, error: error.message });
    } finally {
      trace?.finish();
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
  console.log(`Codex Keyboard bridge ${BRIDGE_VERSION || "unversioned"} listening on http://${HOST}:${PORT}`);
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
