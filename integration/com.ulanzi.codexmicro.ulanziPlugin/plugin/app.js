import WebSocket from "ws";
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
  submit: "SUBMIT"
});
const TASK_ICON_PATHS = Object.freeze({
  idle: "assets/icons/task-idle.png",
  working: "assets/icons/task-working.png",
  complete: "assets/icons/task-complete.png",
  attention: "assets/icons/task-attention.png",
  error: "assets/icons/task-error.png"
});

let socket;
let reconnectTimer;
let pollTimer;
let pollInFlight = false;
let latestState = null;
let setupOperation = null;

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

function taskIconPath(status) {
  const value = String(status || "").toLowerCase();
  if (["working", "thinking", "running", "in_progress"].includes(value)) return TASK_ICON_PATHS.working;
  if (["unread", "complete", "completed", "done", "success"].includes(value)) return TASK_ICON_PATHS.complete;
  if (["attention", "notification", "input", "approval", "waiting_input", "needs_input"].includes(value)) return TASK_ICON_PATHS.attention;
  if (["error", "failed", "failure"].includes(value)) return TASK_ICON_PATHS.error;
  return TASK_ICON_PATHS.idle;
}

function shortTitle(value) {
  const title = String(value || "Untitled").replace(/\s+/g, " ").trim();
  return title.length > 18 ? `${title.slice(0, 17)}…` : title;
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

function setTaskDisplay(instance, path, text) {
  const digest = `path:${path}:${text}`;
  if (!instance.active || instance.lastDisplay === digest) return;
  instance.lastDisplay = digest;
  send({
    cmd: "state",
    param: {
      statelist: [{
        uuid: instance.uuid,
        actionid: instance.actionid,
        key: instance.key,
        type: 2,
        path,
        showtext: true,
        textdata: text
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
        setTaskDisplay(instance, TASK_ICON_PATHS.idle, "Bridge Offline");
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
        setTaskDisplay(instance, TASK_ICON_PATHS.idle, "Latest Task");
        return;
      }
      setTaskDisplay(instance, taskIconPath(task.status), shortTitle(task.title));
      return;
    }
    setDisplay(instance, 0, ACTION_LABELS[action] || "CODEX");
    return;
  }
  if (!latestState?.connected) {
    setTaskDisplay(instance, TASK_ICON_PATHS.idle, "Bridge Offline");
    return;
  }
  const task = latestState.slots?.[slot];
  if (!task?.threadKey) {
    setTaskDisplay(instance, TASK_ICON_PATHS.idle, `Task ${slot + 1}`);
    return;
  }
  setTaskDisplay(instance, taskIconPath(task.status), shortTitle(task.title));
}

function renderAll() {
  for (const instance of instances.values()) renderInstance(instance);
}

async function bridgeRequest(path, method = "GET") {
  const response = await fetch(`${BRIDGE_URL}${path}`, {
    method,
    signal: AbortSignal.timeout(1200)
  });
  const payload = await response.json();
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `Bridge HTTP ${response.status}`);
  }
  return payload;
}

async function openTaskSlot(slot) {
  const task = latestState?.slots?.[slot];
  if (!task?.threadKey) throw new Error(`Codex task slot ${slot + 1} is empty`);
  await bridgeRequest(`/thread/${encodeURIComponent(task.threadKey)}/click?slot=${slot}`, "POST");
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
    renderAll();
  }
}

async function invoke(instance, pressed) {
  const slot = taskSlot(instance.uuid);
  try {
    if (slot !== null) {
      if (!pressed) return;
      await openTaskSlot(slot);
      return;
    }
    const action = actionName(instance.uuid);
    if (!action) throw new Error(`Unknown Codex action: ${instance.uuid}`);
    if (action === "usage") {
      if (pressed) await bridgeRequest("/focus", "POST");
      return;
    }
    await bridgeRequest(`/action/${action}/${pressed ? "down" : "up"}`, "POST");
  } catch (error) {
    send({ cmd: "logMessage", uuid: instance.uuid, actionid: instance.actionid, key: instance.key, level: "error", message: error.message });
    send({ cmd: "showAlert", uuid: instance.uuid, actionid: instance.actionid, key: instance.key });
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
