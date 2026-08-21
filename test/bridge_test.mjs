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
  discoverDebugPort,
  discoverWindowsCodexExecutables,
  focusCodex
} from "../src/bridge/platform.mjs";
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

test("CDP discovery probes the fixed loopback port before platform process inspection", async () => {
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
  assert.equal(processInspections, 0);
});

test("Windows CDP and Appx discovery accept Stable and Beta process shapes", async () => {
  assert.deepEqual(debugPortsFromCommandLines([
    '"ChatGPT.exe" --remote-debugging-address=127.0.0.1 --remote-debugging-port=9222',
    '"ChatGPT (Beta).exe" --remote-debugging-address=127.0.0.1 --remote-debugging-port 9333'
  ].join("\n")), [9222, 9333]);
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

test("Windows background PowerShell calls stay hidden and maximize on fallback focus", async () => {
  const calls = [];
  const execute = async (command, args, options) => {
    calls.push({ command, args, options });
    if (args.join(" ").includes("CODEX_BRIDGE_FOCUS_PID")) {
      return { stdout: "4242\n" };
    }
    return {
      stdout: '\"ChatGPT.exe\" --remote-debugging-address=127.0.0.1 --remote-debugging-port=9333\n'
    };
  };
  await discoverDebugPort({
    platform: "win32",
    execute,
    fetchImpl: async (url) => {
      if (url.includes(":9333/")) return { ok: true, json: async () => ({ Browser: "Chrome" }) };
      throw new Error("offline fixture");
    }
  });
  await focusCodex({ platform: "win32", execute });
  await focusCodex({ platform: "win32", execute });
  assert.equal(calls.length, 3);
  assert.ok(calls.every(({ command, args, options }) =>
    command === "powershell.exe" &&
    options?.windowsHide === true &&
    args.includes("-WindowStyle") &&
    args.includes("Hidden")
  ));
  const focusCalls = calls.slice(1);
  assert.ok(focusCalls.every(({ args, options }) =>
    args.join(" ").includes("ShowWindowAsync($candidate.MainWindowHandle, 3)") &&
    args.join(" ").includes("SetForegroundWindow") &&
    options.timeout === 5000
  ));
  assert.equal(focusCalls[1].options.env.CODEX_BRIDGE_FOCUS_PID, "4242");
});

test("CDP focus maximizes the Codex window before bringing it to the foreground", async () => {
  const client = new CodexCdpClient();
  const calls = [];
  const trace = createTraceFixture();
  client.connect = async () => {};
  client.sendCommand = async (method, params) => {
    calls.push({ method, params });
    return method === "Browser.getWindowForTarget" ? { windowId: 42 } : {};
  };

  await client.focusWindow(trace);

  assert.deepEqual(calls, [
    { method: "Browser.getWindowForTarget", params: {} },
    {
      method: "Browser.setWindowBounds",
      params: { windowId: 42, bounds: { windowState: "maximized" } }
    },
    { method: "Page.bringToFront", params: {} }
  ]);
  assert.deepEqual(
    trace.events.filter(event => event.outcome === "succeeded").map(event => event.stage),
    ["focus.connect", "focus.get-window", "focus.maximize", "focus.bring-to-front"]
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
