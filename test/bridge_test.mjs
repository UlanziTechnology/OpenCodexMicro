import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import vm from "node:vm";

import {
  decodeThreadPathSegment,
  localThreadKey,
  validateThreadId
} from "../src/bridge/thread-key.mjs";
import {
  CodexCdpClient,
  composerSteerExpression,
  modelPreset,
  rendererActionExpression
} from "../src/bridge/codex-cdp.mjs";
import {
  debugPortsFromCommandLines,
  debugProcessesFromCommandLines,
  discoverDebugEndpoint,
  discoverDebugPort,
  discoverWindowsCodexExecutables,
  focusCodex
} from "../src/bridge/platform.mjs";
import { navigateAndFocus } from "../src/bridge/navigation.mjs";
import {
  activateWindowsProcess,
  clearWindowsFocusCache,
  initializeWindowsFocusRuntime
} from "../src/bridge/windows-focus.mjs";
import { bridgeRequestAuthorized } from "../src/bridge/auth.mjs";

const UUID = "f6805b8a-332a-43a0-a118-52d3e59542f6";

function createTraceFixture() {
  const events = [];
  let pending = 0;
  return {
    events,
    get pending() { return pending; },
    record(event, fields = {}) { events.push({ event, ...fields }); },
    defer() {
      pending += 1;
      let settled = false;
      return () => {
        if (settled) return;
        settled = true;
        pending -= 1;
      };
    }
  };
}

test("Bridge write authorization fails closed and accepts only the installed token", () => {
  const token = "fixture-local-capability-token";
  assert.equal(bridgeRequestAuthorized("", `Bearer ${token}`), false);
  assert.equal(bridgeRequestAuthorized(token, ""), false);
  assert.equal(bridgeRequestAuthorized(token, "Bearer wrong-token"), false);
  assert.equal(bridgeRequestAuthorized(token, `Bearer ${token}`), true);
});

test("CDP discovery still probes the fixed loopback port when process identity inspection is denied", async () => {
  const requests = [];
  let processInspections = 0;
  const port = await discoverDebugPort({
    platform: "win32",
    execute: async () => { processInspections += 1; throw new Error("process inspection denied"); },
    fetchImpl: async (url) => {
      requests.push(url);
      return { ok: true, json: async () => ({ Browser: "Chrome" }) };
    }
  });
  assert.equal(port, 9222);
  assert.deepEqual(requests, ["http://127.0.0.1:9222/json/version"]);
  assert.equal(processInspections, 1);
});

test("Windows CDP and Appx discovery accept Stable and Beta process shapes", async () => {
  assert.deepEqual(debugPortsFromCommandLines([
    '"ChatGPT.exe" --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222',
    '"ChatGPT (Beta).exe" --remote-debugging-address=127.0.0.1 --remote-debugging-port 9333'
  ].join("\n")), [9222, 9333]);
  const processRows = JSON.stringify([
    {
      processId: 4101,
      executable: "C:\\WindowsApps\\OpenAI.Codex_Stable\\app\\ChatGPT.exe",
      commandLine: '"ChatGPT.exe" --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222'
    },
    {
      processId: 4202,
      executable: "C:\\WindowsApps\\OpenAI.CodexBeta_Beta\\app\\ChatGPT (Beta).exe",
      commandLine: '"ChatGPT (Beta).exe" --remote-debugging-address=127.0.0.1 --remote-debugging-port=9333'
    }
  ]);
  assert.deepEqual(
    debugProcessesFromCommandLines(processRows).map(({ port, processId, channel }) => ({ port, processId, channel })),
    [
      { port: 9222, processId: 4101, channel: "stable" },
      { port: 9333, processId: 4202, channel: "beta" }
    ]
  );
  const selectedBeta = await discoverDebugEndpoint({
    platform: "win32",
    preferredPort: 9333,
    execute: async () => ({ stdout: processRows }),
    fetchImpl: async (url) => ({ ok: url.includes(":9333/"), json: async () => ({ Browser: "Chrome" }) })
  });
  assert.deepEqual(selectedBeta, {
    port: 9333,
    processId: 4202,
    executable: "C:\\WindowsApps\\OpenAI.CodexBeta_Beta\\app\\ChatGPT (Beta).exe",
    channel: "beta"
  });
  const contestedPortRows = JSON.stringify([
    {
      processId: 4101,
      executable: "C:\\WindowsApps\\OpenAI.Codex_Stable\\app\\ChatGPT.exe",
      commandLine: '"ChatGPT.exe" --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222',
      ownsDebugPort: false
    },
    {
      processId: 4202,
      executable: "C:\\WindowsApps\\OpenAI.CodexBeta_Beta\\app\\ChatGPT (Beta).exe",
      commandLine: '"ChatGPT (Beta).exe" --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222',
      ownsDebugPort: true
    }
  ]);
  const selectedListener = await discoverDebugEndpoint({
    platform: "win32",
    execute: async () => ({ stdout: contestedPortRows }),
    fetchImpl: async () => ({ ok: true, json: async () => ({ Browser: "Chrome" }) })
  });
  assert.equal(selectedListener.processId, 4202);
  assert.equal(selectedListener.channel, "beta");
  let appxOptions;
  const installs = await discoverWindowsCodexExecutables({
    execute: async (_command, _args, options) => {
      appxOptions = options;
      return {
        stdout: JSON.stringify([
          { channel: "stable", packageName: "OpenAI.Codex", executable: "C:\\WindowsApps\\Stable\\app\\ChatGPT.exe" },
          { channel: "beta", packageName: "OpenAI.CodexBeta", executable: "C:\\WindowsApps\\Beta\\app\\ChatGPT (Beta).exe" }
        ])
      };
    }
  });
  assert.deepEqual(installs.map((item) => item.channel), ["stable", "beta"]);
  assert.equal(appxOptions.windowsHide, true);
});

test("Windows native focus maximizes and activates only the connected Stable or Beta process", async () => {
  clearWindowsFocusCache();
  const windows = new Map([[4202, 0xBEEFn]]);
  let foreground = 0xAAAAn;
  let maximized = false;
  const calls = [];
  const api = {
    isWindow: hwnd => hwnd === 0xBEEFn,
    processIdForWindow: hwnd => hwnd === 0xBEEFn ? 4202 : 0,
    findWindowForProcess: processId => windows.get(processId) ?? null,
    getForegroundWindow: () => foreground,
    isZoomed: () => maximized,
    maximize: hwnd => { calls.push(["maximize", hwnd]); maximized = true; return true; },
    foreground: hwnd => { calls.push(["foreground", hwnd]); foreground = hwnd; return true; },
    flash: hwnd => calls.push(["flash", hwnd])
  };
  const result = await activateWindowsProcess(4202, { api, wait: async () => {} });
  assert.equal(result.processId, 4202);
  assert.equal(result.maximized, true);
  assert.deepEqual(calls, [["maximize", 0xBEEFn], ["foreground", 0xBEEFn]]);

  let powershellCalls = 0;
  const focused = await focusCodex({
    platform: "win32",
    processId: 4202,
    execute: async () => { powershellCalls += 1; },
    activateWindows: async processId => ({ processId, alreadyForeground: true, alreadyMaximized: true })
  });
  assert.equal(focused.processId, 4202);
  assert.equal(powershellCalls, 0, "the key hot path must not spawn PowerShell");
});

test("Windows native focus runtime loads the User32 bindings", {
  skip: process.platform !== "win32"
}, async () => {
  assert.equal(await initializeWindowsFocusRuntime(), true);
});

test("Windows native focus uses the bounded attached-input fallback only after foreground denial", async () => {
  clearWindowsFocusCache();
  let foreground = 0x1111n;
  const calls = [];
  const api = {
    isWindow: () => true,
    processIdForWindow: () => 4203,
    findWindowForProcess: () => 0x2222n,
    getForegroundWindow: () => foreground,
    isZoomed: () => true,
    foreground: hwnd => { calls.push(["foreground", hwnd]); return false; },
    forceForeground: hwnd => { calls.push(["forceForeground", hwnd]); foreground = hwnd; },
    flash: hwnd => calls.push(["flash", hwnd])
  };
  const waits = [];
  const result = await activateWindowsProcess(4203, {
    api,
    wait: async milliseconds => waits.push(milliseconds)
  });
  assert.equal(result.alreadyMaximized, true);
  assert.deepEqual(calls, [["foreground", 0x2222n], ["forceForeground", 0x2222n]]);
  assert.deepEqual(waits, [25, 25]);
});

test("Task navigation success is not converted into failure when native focus is denied", async () => {
  const result = await navigateAndFocus(
    async () => "navigated",
    async () => { throw new Error("foreground denied"); }
  );
  assert.deepEqual(result, { focusOk: false });
  await assert.rejects(
    navigateAndFocus(
      async () => { throw new Error("navigation failed"); },
      async () => true
    ),
    /navigation failed/
  );
});

test("task tracing covers native press, detached release, and DOM activation without thread data", async () => {
  const client = new CodexCdpClient();
  const trace = createTraceFixture();
  const calls = [];
  client.dispatchAgent = async (slot, _threadKey, act) => calls.push(["agent", slot, act]);
  client.activateThread = async () => calls.push(["activate"]);

  await client.clickThreadKey("local:private-thread-fixture", 2, trace);
  await new Promise(resolve => setTimeout(resolve, 70));

  assert.deepEqual(calls, [["agent", 2, 1], ["agent", 2, 0], ["activate"]]);
  assert.equal(trace.pending, 0);
  assert.ok(trace.events.some(event => event.stage === "task.native-act1" && event.outcome === "succeeded"));
  assert.ok(trace.events.some(event => event.stage === "task.native-act0" && event.background === true));
  assert.ok(trace.events.some(event => event.stage === "task.dom-activate" && event.background === true));
  assert.doesNotMatch(JSON.stringify(trace.events), /private-thread-fixture/);
});

test("renderer polling traces attempt count and elapsed stage without expression text", async () => {
  const client = new CodexCdpClient();
  const trace = createTraceFixture();
  const results = [false, false, true];
  client.evaluate = async () => results.shift();

  await client.waitForRenderer("private-renderer-expression", "fixture menu", trace, "model.wait-fixture");

  const poll = trace.events.find(event => event.event === "renderer.poll");
  assert.equal(poll?.stage, "model.wait-fixture");
  assert.equal(poll?.attempts, 3);
  assert.equal(poll?.outcome, "succeeded");
  assert.doesNotMatch(JSON.stringify(trace.events), /private-renderer-expression/);
});

test("concurrent CDP connects share one socket and ignore stale socket events", async () => {
  class FakeSocket extends EventEmitter {
    readyState = 0;

    constructor() {
      super();
      queueMicrotask(() => {
        this.readyState = 1;
        this.emit("open");
      });
    }

    send(raw) {
      const { id } = JSON.parse(raw);
      queueMicrotask(() => this.emit("message", JSON.stringify({
        id,
        result: { result: { value: true } }
      })));
    }

    close() {
      this.readyState = 3;
    }
  }

  let discoveries = 0;
  let targetFetches = 0;
  const sockets = [];
  const client = new CodexCdpClient({
    discoverPort: async () => { discoveries += 1; return 9222; },
    fetchTargets: async () => {
      targetFetches += 1;
      return [{ type: "page", url: "app://-/index.html", webSocketDebuggerUrl: "ws://fixture" }];
    },
    createSocket: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    }
  });

  await Promise.all([client.connect(), client.connect()]);
  assert.equal(discoveries, 1);
  assert.equal(targetFetches, 1);
  assert.equal(sockets.length, 1);

  const staleSocket = sockets[0];
  client.disconnect();
  await client.connect();
  staleSocket.emit("close");
  assert.equal(client.socket, sockets[1]);
  client.disconnect();
});

test("accepts formal and explicit temporary Codex thread ids", () => {
  assert.equal(validateThreadId(UUID), UUID);
  assert.equal(
    validateThreadId(`client-new-thread:${UUID}`),
    `client-new-thread:${UUID}`
  );
  assert.equal(localThreadKey(UUID), `local:${UUID}`);
  assert.equal(
    localThreadKey(`client-new-thread:${UUID}`),
    `local:client-new-thread:${UUID}`
  );
});

test("decodes one URL path segment and rejects arbitrary ids", () => {
  assert.equal(
    decodeThreadPathSegment(`client-new-thread%3A${UUID}`),
    `client-new-thread:${UUID}`
  );
  assert.throws(() => validateThreadId("arbitrary-thread"), /Invalid/);
  assert.throws(() => decodeThreadPathSegment("%not-encoded"), /encoded/);
});

test("named Micro actions preserve press and release phases", async () => {
  const client = new CodexCdpClient();
  const calls = [];
  client.dispatchAction = async (...args) => calls.push(args);

  for (const [action, key] of [
    ["fast", "ACT06"],
    ["fork", "ACT09"],
    ["submit", "ACT12"]
  ]) {
    await client.dispatchNamedAction(action, true);
    await client.dispatchNamedAction(action, false);
    assert.deepEqual(calls.splice(0), [[key, 1], [key, 0]]);
  }
});

test("renderer actions and model presets execute once on key down", async () => {
  const client = new CodexCdpClient();
  const calls = [];
  client.dispatchRendererAction = async (action) => calls.push(action);

  for (const action of ["pin", "new", "model-sol-high", "model-luna-max", "model-sol-medium"]) {
    await client.dispatchNamedAction(action, true);
    await client.dispatchNamedAction(action, false);
  }
  assert.deepEqual(calls, ["pin", "new", "model-sol-high", "model-luna-max", "model-sol-medium"]);
});

test("model presets freeze the requested model and effort", () => {
  for (const [action, model, displayName, effort] of [
    ["model-sol-high", "gpt-5.6-sol", "5.6 Sol", "high"],
    ["model-luna-max", "gpt-5.6-luna", "5.6 Luna", "max"],
    ["model-sol-medium", "gpt-5.6-sol", "5.6 Sol", "medium"]
  ]) {
    assert.deepEqual(modelPreset(action), { model, displayName, effort });
  }
  assert.throws(() => modelPreset("unknown"), /Unknown Codex model preset/);
});

test("model renderer actions are serialized before they touch the shared menu", async () => {
  const client = new CodexCdpClient();
  const calls = [];
  let active = 0;
  let maxActive = 0;
  let releaseFirst;
  let markFirstStarted;
  const firstStarted = new Promise(resolve => { markFirstStarted = resolve; });
  const firstGate = new Promise(resolve => { releaseFirst = resolve; });
  client.connect = async () => {};
  client.dispatchModelPreset = async (action) => {
    calls.push(action);
    active += 1;
    maxActive = Math.max(maxActive, active);
    if (calls.length === 1) {
      markFirstStarted();
      await firstGate;
    }
    active -= 1;
  };

  const first = client.dispatchRendererAction("model-sol-high");
  await firstStarted;
  const second = client.dispatchRendererAction("model-sol-medium");
  await Promise.resolve();

  assert.deepEqual(calls, ["model-sol-high"]);
  assert.equal(maxActive, 1);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(calls, ["model-sol-high", "model-sol-medium"]);
  assert.equal(maxActive, 1);
});

test("model presets identify picker rows once per renderer connection", async () => {
  const client = new CodexCdpClient();
  const clickStages = [];
  const effortOrder = ["low", "medium", "high", "xhigh", "max"];
  let currentModel = "5.6 Sol";
  let currentEffort = "medium";
  let expanded = false;

  client.evaluate = async (expression) => {
    if (expression.includes('const triggers = [...document.querySelectorAll("[data-codex-intelligence-trigger]")].filter(visible)')) {
      return { text: currentModel, effort: currentEffort, expanded };
    }
    if (expression.includes("rowCount: menus[0]?.querySelectorAll")) {
      return { count: 0, expanded: true, rowCount: 2 };
    }
    if (expression.includes("return menu?.querySelectorAll") && expression.includes("length ?? 0")) {
      return 2;
    }
    throw new Error(`Unexpected model fixture expression: ${expression.slice(0, 80)}`);
  };
  client.waitForRenderer = async (_expression, description, _trace, stage) => {
    if (description === "Codex model picker submenu") {
      if (stage === "model.wait-submenu-1") {
        return ["5.6 Sol", "5.6 Luna"].map(text => ({ text, checked: text === currentModel }));
      }
      return effortOrder.map(text => ({ text, checked: text === currentEffort }));
    }
    return true;
  };
  client.clickRendererCandidates = async (_expression, description, _trace, stage) => {
    clickStages.push(stage);
    if (stage === "model.open-trigger") expanded = true;
    if (stage === "model.select-model-option") {
      currentModel = description.includes("Luna") ? "5.6 Luna" : "5.6 Sol";
    }
    if (stage === "model.select-effort-option") {
      currentEffort = description.split(" ").at(-1);
    }
  };
  client.pressRendererEscape = async (_trace, stage) => {
    clickStages.push(stage);
    expanded = false;
  };

  const firstTrace = createTraceFixture();
  await client.dispatchModelPreset("model-luna-max", firstTrace);
  assert.equal(clickStages.filter(stage => stage === "model.open-row-1").length, 1);
  assert.equal(clickStages.filter(stage => stage === "model.open-row-2").length, 1);
  const selectionStages = firstTrace.events
    .filter(event => event.event === "cdp.stage" && event.outcome === "started")
    .map(event => event.stage);
  assert.ok(selectionStages.indexOf("model.select-model") < selectionStages.indexOf("model.select-effort"));
  assert.equal(selectionStages.includes("model.select-effort-1"), false);
  assert.equal(selectionStages.includes("model.select-effort-2"), false);

  const cachedTrace = createTraceFixture();
  await client.dispatchModelPreset("model-sol-high", cachedTrace);
  assert.equal(clickStages.filter(stage => stage === "model.open-row-1").length, 1);
  assert.equal(clickStages.filter(stage => stage === "model.open-row-2").length, 1);
  assert.ok(cachedTrace.events.some(event =>
    event.event === "model.rows-identified" && event.source === "cache"
  ));

  client.disconnect();
  await client.dispatchModelPreset("model-luna-max", createTraceFixture());
  assert.equal(clickStages.filter(stage => stage === "model.open-row-1").length, 2);
  assert.equal(clickStages.filter(stage => stage === "model.open-row-2").length, 2);
});

test("new renderer action accepts the current localized New conversation control", () => {
  let clicks = 0;
  const button = {
    offsetParent: {},
    innerText: "",
    getAttribute(name) {
      return name === "aria-label" ? "新对话" : null;
    },
    click() { clicks += 1; }
  };
  const document = {
    querySelector() { return null; },
    querySelectorAll(selector) {
      assert.equal(selector, "button");
      return [button];
    }
  };

  assert.equal(
    vm.runInNewContext(rendererActionExpression("new"), { document }),
    true
  );
  assert.equal(clicks, 1);
});

test("new renderer action prefers the language-independent sidebar structure", () => {
  let structuralClicks = 0;
  let localizedClicks = 0;
  const structuralButton = {
    offsetParent: {},
    click() { structuralClicks += 1; }
  };
  const localizedButton = {
    offsetParent: {},
    innerText: "New conversation",
    getAttribute() { return null; },
    click() { localizedClicks += 1; }
  };
  const sidebar = {
    querySelectorAll(selector) {
      assert.equal(selector, ".sidebar-item.relative > button.sidebar-item");
      return [structuralButton];
    }
  };
  const anchor = { closest: selector => selector === "nav" ? sidebar : null };
  const document = {
    querySelector(selector) {
      return selector === "[data-app-action-sidebar-project-create]" ? anchor : null;
    },
    querySelectorAll() { return [localizedButton]; }
  };

  assert.equal(
    vm.runInNewContext(rendererActionExpression("new"), { document }),
    true
  );
  assert.equal(structuralClicks, 1);
  assert.equal(localizedClicks, 0);
});

test("pin renderer action accepts the current localized Pin chat control", () => {
  let clicks = 0;
  const button = {
    offsetParent: {},
    getAttribute(name) {
      return name === "aria-label" ? "置顶聊天" : null;
    },
    click() { clicks += 1; }
  };
  const active = { querySelectorAll: () => [button] };
  const document = {
    querySelector(selector) {
      return selector === "[data-app-action-sidebar-thread-active=true]" ? active : null;
    }
  };

  assert.equal(
    vm.runInNewContext(rendererActionExpression("pin"), { document }),
    true
  );
  assert.equal(clicks, 1);
});

test("steer renderer action accepts the current localized control", () => {
  let focused = 0;
  let clicks = 0;
  const editor = { offsetParent: {}, focus() { focused += 1; } };
  const button = {
    offsetParent: {},
    innerText: "",
    getAttribute(name) {
      return name === "aria-label" ? "调整方向" : null;
    },
    click() { clicks += 1; }
  };
  const document = {
    querySelectorAll(selector) {
      return selector === "button" ? [button] : [editor];
    }
  };

  assert.equal(
    vm.runInNewContext(composerSteerExpression(), { document }),
    true
  );
  assert.equal(focused, 1);
  assert.equal(clicks, 1);
});

test("unknown bridge actions are rejected", async () => {
  const client = new CodexCdpClient();
  await assert.rejects(
    client.dispatchNamedAction("unknown", true),
    /Unsupported Codex bridge action/
  );
});
