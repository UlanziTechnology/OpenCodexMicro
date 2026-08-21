import WebSocket from "ws";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createBridgeInstaller } from "./bridge-installer.js";

const PLUGIN_UUID = "com.ulanzi.ulanzistudio.codexmicro";
const BRIDGE_URL = process.env.CODEX_BRIDGE_URL || "http://127.0.0.1:17373";
const [address = "127.0.0.1", port = "3906"] = process.argv.slice(2);
const HOST_URL = `ws://${address}:${port}`;
const instances = new Map();
const PLUGIN_ROOT = resolve(dirname(resolve(process.argv[1])), "..");
const MANIFEST = JSON.parse(readFileSync(resolve(PLUGIN_ROOT, "manifest.json"), "utf8"));
const bridgeSetup = createBridgeInstaller({
  pluginRoot: PLUGIN_ROOT,
  bridgeUrl: BRIDGE_URL,
  version: MANIFEST.Version
});
let bridgeReconcilePromise = null;
let bridgeReconcileRetryTimer = null;
let bridgeReconcileFailures = 0;

function scheduleBridgeReconcileRetry() {
  if (bridgeReconcileRetryTimer || bridgeReconcileFailures >= 3) return;
  const delay = Math.min(10000, 2000 * (2 ** bridgeReconcileFailures));
  bridgeReconcileFailures += 1;
  bridgeReconcileRetryTimer = setTimeout(() => {
    bridgeReconcileRetryTimer = null;
    void ensureBundledBridgeCurrent().catch(error => {
      console.error(`[Codex Micro] Bridge reconciliation retry failed: ${error.message}`);
    });
  }, delay);
  bridgeReconcileRetryTimer.unref?.();
}

function ensureBundledBridgeCurrent() {
  if (!bridgeReconcilePromise) {
    const running = (async () => {
      const before = await bridgeSetup.status();
      if (!before.installationDetected) return before;
      if (before.needsUpdate) {
        console.log(`[Codex Micro] Updating the installed Bridge to bundled version ${before.bundledVersion}.`);
      }
      const after = await bridgeSetup.ensureCurrent();
      if (before.needsUpdate) {
        console.log(`[Codex Micro] Bridge ${after.installedVersion} restarted with the bundled runtime.`);
      }
      return after;
    })();
    bridgeReconcilePromise = running;
    void running.then(() => {
      bridgeReconcileFailures = 0;
      if (bridgeReconcileRetryTimer) clearTimeout(bridgeReconcileRetryTimer);
      bridgeReconcileRetryTimer = null;
    }, () => {
      if (bridgeReconcilePromise === running) bridgeReconcilePromise = null;
      scheduleBridgeReconcileRetry();
    });
  }
  return bridgeReconcilePromise;
}
const USAGE_BASE64 = readFileSync(
  resolve(PLUGIN_ROOT, "assets/icons/usage-base.png")
).toString("base64");
const ACTION_LABELS = Object.freeze({
  fast: "FAST",
  usage: "USAGE",
  pin: "PIN",
  new: "NEW",
  navigate: "LATEST",
  fork: "FORK",
  steer: "STEER",
  mic: "MIC",
  submit: "SUBMIT",
  "model-sol-high": "SOL HIGH",
  "model-luna-max": "LUNA MAX",
  "model-sol-medium": "SOL MED"
});
const DEBUG_MODEL_PRESETS = Object.freeze({
  "model-sol-high": Object.freeze({ model: "gpt-5.6-sol", effort: "high" }),
  "model-luna-max": Object.freeze({ model: "gpt-5.6-luna", effort: "max" }),
  "model-sol-medium": Object.freeze({ model: "gpt-5.6-sol", effort: "medium" })
});
const TASK_STATUS_PALETTES = Object.freeze({
  idle: { frame: "#475467", accent: "#98a2b3" },
  working: { frame: "#0b5fcc", accent: "#2589f5" },
  complete: { frame: "#087443", accent: "#28b875" },
  attention: { frame: "#9a6700", accent: "#ed9f20" },
  error: { frame: "#b42318", accent: "#e34d62" }
});
const TASK_COMPLETE_FLASH_PALETTE = Object.freeze({ frame: "#12b76a", accent: "#6ce9a6" });
const TASK_TITLE_MAX_UNITS = 10;
const TASK_TITLE_MAX_LINES = 4;
const TASK_TITLE_SEGMENTER = typeof Intl.Segmenter === "function"
  ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
  : null;

let socket;
let reconnectTimer;
let pollTimer;
let pollInFlight = false;
let latestState = null;
let setupOperation = null;
let completeFlashOn = false;
let shortcutInvocationSequence = 0;
const forwardedTraceEvents = new Map();

function contextOf(message) {
  return String(message.actionid || `${message.uuid}___${message.key}`);
}

function taskSlot(uuid) {
  const match = String(uuid || "").match(/\.task([1-5])$/);
  return match ? Number(match[1]) - 1 : null;
}

function actionName(uuid) {
  const name = String(uuid || "").split(".").at(-1);
  return Object.hasOwn(ACTION_LABELS, name) ? name : null;
}

function usageRemaining(usage) {
  const windows = Array.isArray(usage?.windows) ? usage.windows : [];
  const window = windows.find((item) => item?.kind === "weekly") ?? windows[0];
  const remaining = Number(window?.remainingPercent);
  return Number.isFinite(remaining)
    ? Math.max(0, Math.min(100, Math.round(remaining)))
    : null;
}

function usageIconData(usage) {
  const remaining = usageRemaining(usage);
  const progress = remaining === null
    ? "#858c8f"
    : remaining >= 50
      ? "#2fbd7f"
      : remaining >= 20
        ? "#e89b2d"
        : "#e45861";
  const circumference = 2 * Math.PI * 57;
  const filled = circumference * (remaining ?? 0) / 100;
  const value = remaining === null ? "—" : String(remaining);
  const percent = remaining === null ? "" : "%";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="196" height="196" viewBox="0 0 196 196">
    <defs>
      <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
        <feGaussianBlur stdDeviation="4.5" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
    </defs>
    <image width="196" height="196" href="data:image/png;base64,${USAGE_BASE64}" xlink:href="data:image/png;base64,${USAGE_BASE64}"/>
    <g fill="none" transform="rotate(-90 98 94)">
      <circle cx="98" cy="94" r="58.5" stroke="#ffffff" stroke-opacity=".57" stroke-width="2.4"/>
      <circle cx="98" cy="94" r="57" stroke="#5e6c68" stroke-opacity=".57" stroke-width="16"/>
      <circle cx="98" cy="94" r="57" stroke="#a0aca9" stroke-width="12"/>
      <circle cx="98" cy="94" r="57" stroke="#cdd6d3" stroke-width="6"/>
      ${remaining === null ? "" : `<circle cx="98" cy="94" r="57" stroke="${progress}" stroke-opacity=".5" stroke-width="18" stroke-linecap="butt" stroke-dasharray="${filled} ${circumference - filled}" filter="url(#glow)"/><circle cx="98" cy="94" r="57" stroke="${progress}" stroke-width="10" stroke-linecap="butt" stroke-dasharray="${filled} ${circumference - filled}"/>`}
    </g>
    <text x="98" y="105" fill="#303638" font-family="-apple-system,BlinkMacSystemFont,Arial,sans-serif" font-size="36" font-weight="700" text-anchor="middle">${value}${percent ? `<tspan dx="2" dy="-2" font-size="18">${percent}</tspan>` : ""}</text>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function send(message) {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

function ack(message) {
  send({
    code: 0,
    cmd: message.cmd,
    uuid: message.uuid,
    actionid: message.actionid,
    key: message.key,
    active: message.active,
    param: message.param || {}
  });
}

function sendToInspector(message, payload) {
  send({
    cmd: "sendToPropertyInspector",
    uuid: message.uuid,
    actionid: message.actionid,
    key: message.key,
    payload
  });
}

async function sendBridgeSetupStatus(message, extra = {}) {
  const status = await bridgeSetup.status();
  sendToInspector(message, {
    type: "bridgeSetupStatus",
    status,
    busy: Boolean(setupOperation),
    operation: setupOperation,
    ...extra
  });
}

async function handleBridgeSetupMessage(message) {
  const action = message.payload?.action;
  if (action === "openGuide") {
    send({
      cmd: "openurl",
      url: "https://github.com/UlanziTechnology/OpenCodexMicro#1-llm--agent-installation",
      local: false
    });
    await sendBridgeSetupStatus(message);
    return;
  }
  if (action === "status" || !action) {
    await sendBridgeSetupStatus(message);
    return;
  }
  if (!["install", "launch", "uninstall"].includes(action)) {
    await sendBridgeSetupStatus(message, { error: `Unknown setup action: ${action}` });
    return;
  }
  if (setupOperation) {
    await sendBridgeSetupStatus(message);
    return;
  }

  setupOperation = action;
  await sendBridgeSetupStatus(message);
  let result = null;
  let failure = null;
  try {
    if (action === "install") await bridgeSetup.install();
    if (action === "launch") await bridgeSetup.launch();
    if (action === "uninstall") await bridgeSetup.uninstall();
    result = action;
  } catch (error) {
    failure = error.message;
    send({
      cmd: "logMessage",
      uuid: message.uuid,
      actionid: message.actionid,
      key: message.key,
      level: "error",
      message: `Codex Bridge ${action} failed: ${error.message}`
    });
  } finally {
    setupOperation = null;
  }
  await sendBridgeSetupStatus(message, { result, error: failure });
}

function taskStatusKind(status) {
  const value = String(status || "").toLowerCase();
  if (["working", "thinking", "running", "in_progress"].includes(value)) return "working";
  if (["unread", "complete", "completed", "done", "success"].includes(value)) return "complete";
  if (["attention", "notification", "input", "approval", "waiting_input", "needs_input"].includes(value)) return "attention";
  if (["error", "failed", "failure"].includes(value)) return "error";
  return "idle";
}

function debugShortcut(uuid) {
  const slot = taskSlot(uuid);
  if (slot !== null) {
    return Object.freeze({ name: `task-${slot + 1}`, kind: "task", target: `slot-${slot + 1}` });
  }
  const action = actionName(uuid);
  const preset = DEBUG_MODEL_PRESETS[action];
  if (!preset) return null;
  return Object.freeze({
    name: action,
    kind: "model-preset",
    target: `model-${preset.model} effort-${preset.effort}`
  });
}

function shortcutErrorCategory(error) {
  const name = String(error?.name || "").toLowerCase();
  const message = String(error?.message || "").toLowerCase();
  if (name.includes("timeout") || message.includes("timeout")) return "bridge-timeout";
  if (message.includes("is empty")) return "empty-task-slot";
  if (message.includes("fetch failed") || message.includes("econnrefused")) return "bridge-unavailable";
  if (message.includes("authorization") || message.includes("unauthorized") || message.includes("forbidden")) {
    return "bridge-rejected";
  }
  return "bridge-error";
}

function logShortcut(instance, shortcut, level, event, fields = []) {
  const message = `[Codex Micro] shortcut event=${event} name=${shortcut.name} kind=${shortcut.kind} ${fields.join(" ")}`.trim();
  if (level === "error") console.error(message);
  else if (level === "warn") console.warn(message);
  else console.log(message);
  send({
    cmd: "logMessage",
    uuid: PLUGIN_UUID,
    actionid: "",
    key: "",
    level,
    message
  });
}

function safeDiagnosticFields(event) {
  const allowed = new Set([
    "action", "attempts", "background", "category", "channel", "complete", "connection",
    "currentEffort", "durationMs", "effortMatched", "modelMatched", "outcome",
    "focusOk", "path", "phase", "platform", "reused", "route", "rowCount", "slot", "stage",
    "targetEffort"
  ]);
  return Object.entries(event || {}).flatMap(([key, value]) => {
    if (!allowed.has(key)) return [];
    if (typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) {
      return [`${key}=${value}`];
    }
    const normalized = String(value || "");
    return /^[a-zA-Z0-9_.:-]{1,80}$/.test(normalized) ? [`${key}=${normalized}`] : [];
  });
}

async function forwardBridgeDiagnostics(instance, shortcut, traceId) {
  try {
    if (forwardedTraceEvents.get(traceId) === Infinity) return true;
    const payload = await bridgeRequest("/diagnostics/trace", "POST", traceId);
    const diagnostics = payload?.diagnostics;
    if (!diagnostics || diagnostics.traceId !== traceId || !Array.isArray(diagnostics.events)) return false;
    const seen = forwardedTraceEvents.get(traceId) || 0;
    for (const event of diagnostics.events.slice(seen, 160)) {
      const eventName = String(event?.event || "");
      if (!/^[a-z0-9.-]{1,80}$/.test(eventName)) continue;
      logShortcut(instance, shortcut, event.outcome === "failed" ? "error" : "debug", "bridge-trace", [
        `trace=${traceId}`,
        `bridgeEvent=${eventName}`,
        `offsetMs=${Math.max(0, Math.round(Number(event.offsetMs) || 0))}`,
        ...safeDiagnosticFields(event)
      ]);
    }
    forwardedTraceEvents.set(traceId, diagnostics.events.length);
    if (diagnostics.complete) forwardedTraceEvents.set(traceId, Infinity);
    return Boolean(diagnostics.complete);
  } catch {
    return false;
  }
}

function collectBridgeDiagnostics(instance, shortcut, traceId) {
  const delays = [0, 400, 1200, 2600, 5200];
  for (const delay of delays) {
    const timer = setTimeout(() => void forwardBridgeDiagnostics(instance, shortcut, traceId), delay);
    timer.unref?.();
  }
  const cleanup = setTimeout(() => forwardedTraceEvents.delete(traceId), 10000);
  cleanup.unref?.();
}

function titleGraphemes(value) {
  const title = String(value || "Untitled").replace(/\s+/g, " ").trim() || "Untitled";
  if (!TASK_TITLE_SEGMENTER) return Array.from(title);
  return Array.from(TASK_TITLE_SEGMENTER.segment(title), item => item.segment);
}

function graphemeUnits(value) {
  if (/^\s$/u.test(value)) return 0.55;
  if (/^\p{Mark}+$/u.test(value)) return 0;
  if (/\p{Extended_Pictographic}/u.test(value) || /[\u1100-\u11ff\u2e80-\ua4cf\uac00-\ud7af\uf900-\ufaff\ufe10-\ufe6f\uff01-\uff60\uffe0-\uffe6]/u.test(value)) return 2;
  if (/^[ilI1.,'`:;|!\[\](){}]$/u.test(value)) return 0.55;
  if (/^[mwMW@#%&]$/u.test(value)) return 1.35;
  return 1;
}

function lineUnits(values) {
  return values.reduce((total, value) => total + graphemeUnits(value), 0);
}

function trimLine(values) {
  const result = [...values];
  while (result[0] === " ") result.shift();
  while (result.at(-1) === " ") result.pop();
  return result;
}

function taskTitleLines(value) {
  let graphemes = titleGraphemes(value);
  const maxTotalUnits = TASK_TITLE_MAX_UNITS * TASK_TITLE_MAX_LINES;
  if (lineUnits(graphemes) > maxTotalUnits) {
    const ellipsisUnits = graphemeUnits("…");
    const clipped = [];
    let used = 0;
    for (const grapheme of graphemes) {
      const units = graphemeUnits(grapheme);
      if (used + units + ellipsisUnits > maxTotalUnits) break;
      clipped.push(grapheme);
      used += units;
    }
    graphemes = trimLine(clipped);
    graphemes.push("…");
  }

  const lines = [];
  while (graphemes.length && lines.length < TASK_TITLE_MAX_LINES) {
    const line = [];
    while (graphemes.length && lineUnits([...line, graphemes[0]]) <= TASK_TITLE_MAX_UNITS) {
      line.push(graphemes.shift());
    }
    if (!line.length) line.push(graphemes.shift());
    const trimmed = trimLine(line);
    if (trimmed.length) lines.push(trimmed.join(""));
    while (graphemes[0] === " ") graphemes.shift();
  }
  if (graphemes.length && lines.length === TASK_TITLE_MAX_LINES && !lines.at(-1).endsWith("…")) {
    const lastLine = titleGraphemes(lines.at(-1));
    while (lastLine.length && lineUnits([...lastLine, "…"]) > TASK_TITLE_MAX_UNITS) lastLine.pop();
    lines[lines.length - 1] = `${trimLine(lastLine).join("")}…`;
  }
  return lines;
}

function taskIconData(kind, flashOn = false) {
  const palette = kind === "complete" && flashOn
    ? TASK_COMPLETE_FLASH_PALETTE
    : TASK_STATUS_PALETTES[kind];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="196" height="196" viewBox="0 0 196 196">
    <rect width="196" height="196" rx="30" fill="#07111f"/>
    <rect x="5" y="5" width="186" height="186" rx="27" fill="${palette.frame}"/>
    <rect data-role="title-surface" x="12" y="12" width="172" height="172" rx="22" fill="#0b1220" fill-opacity=".94"/>
    <rect x="12" y="12" width="172" height="9" rx="4.5" fill="${palette.accent}"/>
    <circle cx="170" cy="33" r="5" fill="${palette.accent}"/>
    <circle cx="154" cy="33" r="3" fill="${palette.accent}" fill-opacity=".35"/>
    <path d="M28 168H168" stroke="${palette.accent}" stroke-opacity=".45" stroke-width="3" stroke-linecap="round"/>
  </svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}

function setDisplay(instance, state, text) {
  const digest = `${state}:${text}`;
  if (!instance.active || instance.lastDisplay === digest) return;
  instance.lastDisplay = digest;
  send({
    cmd: "state",
    param: {
      statelist: [{
        uuid: instance.uuid,
        actionid: instance.actionid,
        key: instance.key,
        type: 0,
        state,
        showtext: true,
        textdata: text
      }]
    }
  });
}

function setTaskDisplay(instance, status, title) {
  const kind = taskStatusKind(status);
  const lines = taskTitleLines(title);
  const displayTitle = lines.join("\n");
  const flashOn = kind === "complete" && completeFlashOn;
  const digest = `task:${kind}:${flashOn}:${displayTitle}`;
  if (!instance.active || instance.lastDisplay === digest) return;
  instance.lastDisplay = digest;
  send({
    cmd: "state",
    param: {
      statelist: [{
        uuid: instance.uuid,
        actionid: instance.actionid,
        key: instance.key,
        type: 1,
        data: taskIconData(kind, flashOn),
        showtext: true,
        textData: displayTitle,
        textdata: displayTitle
      }]
    }
  });
}

function setUsageDisplay(instance, usage) {
  const remaining = usageRemaining(usage);
  const digest = `usage:${remaining ?? "unknown"}`;
  if (!instance.active || instance.lastDisplay === digest) return;
  instance.lastDisplay = digest;
  send({
    cmd: "state",
    param: {
      statelist: [{
        uuid: instance.uuid,
        actionid: instance.actionid,
        key: instance.key,
        type: 1,
        data: usageIconData(usage),
        showtext: true,
        textdata: ACTION_LABELS.usage
      }]
    }
  });
}

function renderInstance(instance) {
  const slot = taskSlot(instance.uuid);
  if (slot === null) {
    const action = actionName(instance.uuid);
    if (!latestState?.connected) {
      if (action === "navigate") {
        setTaskDisplay(instance, "idle", "Bridge Offline");
      } else {
        setDisplay(instance, 0, "Bridge Offline");
      }
      return;
    }
    if (action === "usage") {
      setUsageDisplay(instance, latestState.usage);
      return;
    }
    if (action === "navigate") {
      const task = latestState.slots?.[0];
      if (!task?.threadKey) {
        setTaskDisplay(instance, "idle", "Latest Task");
        return;
      }
      setTaskDisplay(instance, task.status, task.title);
      return;
    }
    setDisplay(instance, 0, ACTION_LABELS[action] || "CODEX");
    return;
  }
  if (!latestState?.connected) {
    setTaskDisplay(instance, "idle", "Bridge Offline");
    return;
  }
  const task = latestState.slots?.[slot];
  if (!task?.threadKey) {
    setTaskDisplay(instance, "idle", `Task ${slot + 1}`);
    return;
  }
  setTaskDisplay(instance, task.status, task.title);
}

function renderAll() {
  for (const instance of instances.values()) renderInstance(instance);
}

async function bridgeRequest(path, method = "GET", traceId = null) {
  const headers = { ...await bridgeSetup.authorizationHeaders() };
  if (traceId) headers["X-Codex-Trace-Id"] = traceId;
  const response = await fetch(`${BRIDGE_URL}${path}`, {
    method,
    headers,
    signal: AbortSignal.timeout(1200)
  });
  const payload = await response.json();
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `Bridge HTTP ${response.status}`);
  }
  return payload;
}

async function openTaskSlot(slot, traceId) {
  const task = latestState?.slots?.[slot];
  if (!task?.threadKey) throw new Error(`Codex task slot ${slot + 1} is empty`);
  await bridgeRequest(`/thread/${encodeURIComponent(task.threadKey)}/click?slot=${slot}`, "POST", traceId);
}

async function pollBridge() {
  if (pollInFlight) return;
  pollInFlight = true;
  try {
    latestState = await bridgeRequest("/state");
  } catch (error) {
    latestState = { connected: false, error: error.message, slots: [] };
  } finally {
    pollInFlight = false;
    completeFlashOn = !completeFlashOn;
    renderAll();
  }
}

async function invoke(instance, pressed) {
  const slot = taskSlot(instance.uuid);
  const shortcut = debugShortcut(instance.uuid);
  const invocation = shortcut ? ++shortcutInvocationSequence : null;
  const traceId = shortcut ? randomUUID() : null;
  const phase = pressed ? "down" : "up";
  const startedAt = Date.now();
  if (shortcut) {
    logShortcut(instance, shortcut, "debug", "received", [
      `invocation=${invocation}`,
      `trace=${traceId}`,
      `phase=${phase}`,
      `target=${shortcut.target}`
    ]);
  }
  try {
    if (slot !== null) {
      if (!pressed) {
        if (shortcut) {
          logShortcut(instance, shortcut, "debug", "ignored", [
            `invocation=${invocation}`,
            `phase=${phase}`,
            "reason=keydown-only"
          ]);
        }
        return;
      }
      if (shortcut) {
        logShortcut(instance, shortcut, "debug", "dispatching", [
          `invocation=${invocation}`,
          `phase=${phase}`,
          "transport=bridge-http"
        ]);
      }
      await openTaskSlot(slot, traceId);
      if (shortcut) {
        logShortcut(instance, shortcut, "info", "succeeded", [
          `invocation=${invocation}`,
          `phase=${phase}`,
          `durationMs=${Date.now() - startedAt}`
        ]);
      }
      return;
    }
    const action = actionName(instance.uuid);
    if (!action) throw new Error(`Unknown Codex action: ${instance.uuid}`);
    if (action === "usage") {
      if (pressed) await bridgeRequest("/focus", "POST");
      return;
    }
    if (shortcut) {
      logShortcut(instance, shortcut, "debug", "dispatching", [
        `invocation=${invocation}`,
        `phase=${phase}`,
        "transport=bridge-http"
      ]);
    }
    await bridgeRequest(`/action/${action}/${pressed ? "down" : "up"}`, "POST", traceId);
    if (shortcut) {
      logShortcut(instance, shortcut, "info", "succeeded", [
        `invocation=${invocation}`,
        `phase=${phase}`,
        `durationMs=${Date.now() - startedAt}`
      ]);
    }
  } catch (error) {
    if (shortcut) {
      logShortcut(instance, shortcut, "error", "failed", [
        `invocation=${invocation}`,
        `phase=${phase}`,
        `durationMs=${Date.now() - startedAt}`,
        `category=${shortcutErrorCategory(error)}`
      ]);
    } else {
      send({
        cmd: "logMessage",
        uuid: instance.uuid,
        actionid: instance.actionid,
        key: instance.key,
        level: "error",
        message: `[Codex Micro] action failed category=${shortcutErrorCategory(error)}`
      });
    }
    send({ cmd: "showAlert", uuid: instance.uuid, actionid: instance.actionid, key: instance.key });
  } finally {
    if (shortcut && pressed) collectBridgeDiagnostics(instance, shortcut, traceId);
  }
}

async function invokeEncoder(instance, message) {
  try {
    if (message.cmd === "dialdown") {
      await openTaskSlot(0);
      return;
    }
    if (message.cmd !== "dialrotate") return;
    const keylist = {
      left: "SCROLL UP",
      "hold-left": "SCROLL UP",
      right: "SCROLL DOWN",
      "hold-right": "SCROLL DOWN"
    }[message.rotateEvent];
    if (keylist) send({ cmd: "hotkey", keylist });
  } catch (error) {
    send({ cmd: "logMessage", uuid: instance.uuid, actionid: instance.actionid, key: instance.key, level: "error", message: error.message });
    send({ cmd: "showAlert", uuid: instance.uuid, actionid: instance.actionid, key: instance.key });
  }
}

function addInstance(message) {
  const context = contextOf(message);
  const existing = instances.get(context);
  const instance = existing || {
    uuid: message.uuid,
    actionid: message.actionid,
    key: message.key,
    active: true,
    lastDisplay: null
  };
  instance.active = true;
  instances.set(context, instance);
  renderInstance(instance);
  return instance;
}

function handleMessage(raw) {
  let message;
  try {
    message = JSON.parse(String(raw));
  } catch {
    return;
  }
  if (message.cmd === "add" || message.cmd === "paramfromapp") {
    addInstance(message);
    ack(message);
    return;
  }
  if (message.cmd === "setactive") {
    const instance = instances.get(contextOf(message)) || addInstance(message);
    instance.active = Boolean(message.active);
    if (instance.active) {
      instance.lastDisplay = null;
      renderInstance(instance);
    }
    ack(message);
    return;
  }
  if (message.cmd === "clear") {
    for (const item of message.param || []) instances.delete(contextOf(item));
    ack(message);
    return;
  }
  if (message.cmd === "sendToPlugin") {
    ack(message);
    if (message.payload?.type === "bridgeSetup") {
      void handleBridgeSetupMessage(message);
    }
    return;
  }
  if (message.cmd === "run") {
    ack(message);
    return;
  }
  if (["dialdown", "dialup", "dialrotate"].includes(message.cmd)) {
    const instance = instances.get(contextOf(message)) || addInstance(message);
    if (actionName(instance.uuid) === "navigate") void invokeEncoder(instance, message);
    ack(message);
    return;
  }
  if (["keydown", "keyup"].includes(message.cmd)) {
    const instance = instances.get(contextOf(message)) || addInstance(message);
    void invoke(instance, message.cmd !== "keyup");
    ack(message);
  }
}

function connect() {
  clearTimeout(reconnectTimer);
  socket = new WebSocket(HOST_URL);
  socket.on("open", () => {
    send({ code: 0, cmd: "connected", uuid: PLUGIN_UUID });
    if (process.env.CODEX_BRIDGE_AUTOSTART !== "0") {
      void ensureBundledBridgeCurrent().catch(error => {
        console.error(`[Codex Micro] Automatic Bridge reconciliation failed: ${error.message}`);
      });
    }
    clearInterval(pollTimer);
    pollTimer = setInterval(() => void pollBridge(), 500);
    pollTimer.unref();
    void pollBridge();
  });
  socket.on("message", handleMessage);
  socket.on("close", () => {
    clearInterval(pollTimer);
    reconnectTimer = setTimeout(connect, 1000);
    reconnectTimer.unref();
  });
  socket.on("error", () => socket.close());
}

connect();

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    clearTimeout(reconnectTimer);
    clearInterval(pollTimer);
    socket?.close();
    process.exit(0);
  });
}
