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
import { safeTraceFields } from "../src/bridge/diagnostics.mjs";

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

test("bridge trace fields use an explicit non-sensitive allowlist", () => {
  assert.deepEqual(safeTraceFields({
    route: "thread-click",
    stage: "initial-foreground",
    accepted: false,
    attentionRequested: true,
    automatic: true,
    candidateCount: 2,
    durationMs: 25,
    foregroundAttachErrorCode: 5,
    forceFocus: true,
    inputEventsInserted: 2,
    primaryCandidate: true,
    wasActiveBeforeAttention: false,
    title: "SafeLookingButPrivate",
    windowTitle: "PrivateWindow",
    hwnd: 1234,
    pid: 4202,
    threadId: 88,
    secret: "private",
    pathWithSpaces: "not allowed",
    invalidNumber: Number.NaN
  }), {
    route: "thread-click",
    stage: "initial-foreground",
    accepted: false,
    attentionRequested: true,
    automatic: true,
    candidateCount: 2,
    durationMs: 25,
    foregroundAttachErrorCode: 5,
    forceFocus: true,
    inputEventsInserted: 2,
    primaryCandidate: true,
    wasActiveBeforeAttention: false
  });
});

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
  const diagnostics = [];
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
  const result = await activateWindowsProcess(4202, {
    api,
    wait: async () => {},
    onDiagnostic: (stage, fields) => diagnostics.push({ stage, ...fields })
  });
  assert.equal(result.processId, 4202);
  assert.equal(result.maximized, true);
  assert.deepEqual(calls, [["maximize", 0xBEEFn], ["foreground", 0xBEEFn]]);
  assert.deepEqual(diagnostics.map(event => event.stage), [
    "target-selection",
    "maximize",
    "initial-foreground",
    "verify-foreground-immediate"
  ]);
  assert.equal(diagnostics[0].source, "discovery");
  assert.equal(diagnostics[2].accepted, true);
  assert.equal(diagnostics[3].matchesTarget, true);

  const cachedDiagnostics = [];
  await activateWindowsProcess(4202, {
    api,
    wait: async () => {},
    onDiagnostic: (stage, fields) => cachedDiagnostics.push({ stage, ...fields })
  });
  assert.equal(cachedDiagnostics[0].source, "cache");
  assert.equal(cachedDiagnostics[0].cacheValid, true);

  let powershellCalls = 0;
  const onDiagnostic = () => {};
  let forwardedDiagnostic = null;
  let forwardedForceFocus = null;
  const focused = await focusCodex({
    platform: "win32",
    processId: 4202,
    execute: async () => { powershellCalls += 1; },
    onDiagnostic,
    forceFocus: true,
    activateWindows: async (processId, options) => {
      forwardedDiagnostic = options.onDiagnostic;
      forwardedForceFocus = options.forceFocus;
      return { processId, alreadyForeground: true, alreadyMaximized: true };
    }
  });
  assert.equal(focused.processId, 4202);
  assert.equal(powershellCalls, 0, "the key hot path must not spawn PowerShell");
  assert.equal(forwardedDiagnostic, onDiagnostic);
  assert.equal(forwardedForceFocus, true);
});

test("Windows native focus revalidates cached windows and rediscovers ranked PID candidates", async () => {
  clearWindowsFocusCache();
  const firstPrimary = 0x1001n;
  const secondPrimary = 0x1002n;
  const ownedFallback = 0x1003n;
  let firstPrimaryValid = true;
  let foreground = 0xAAAAn;
  let discovery = 0;
  const calls = [];
  const api = {
    isWindow: () => true,
    processIdForWindow: () => 4210,
    isWindowCandidate: hwnd => hwnd !== firstPrimary || firstPrimaryValid,
    isPrimaryWindowCandidate: hwnd => hwnd !== ownedFallback,
    findWindowsForProcess: () => {
      discovery += 1;
      return discovery === 1
        ? [firstPrimary, ownedFallback]
        : [secondPrimary, ownedFallback];
    },
    getForegroundWindow: () => foreground,
    isZoomed: () => true,
    foreground: hwnd => { calls.push(["foreground", hwnd]); foreground = hwnd; return true; }
  };

  const firstDiagnostics = [];
  await activateWindowsProcess(4210, {
    api,
    wait: async () => {},
    onDiagnostic: (stage, fields) => firstDiagnostics.push({ stage, ...fields })
  });
  assert.equal(firstDiagnostics[0].candidateCount, 2);
  assert.equal(firstDiagnostics[0].primaryCandidate, true);

  firstPrimaryValid = false;
  foreground = 0xAAAAn;
  const rediscoveredDiagnostics = [];
  await activateWindowsProcess(4210, {
    api,
    wait: async () => {},
    onDiagnostic: (stage, fields) => rediscoveredDiagnostics.push({ stage, ...fields })
  });

  assert.deepEqual(calls, [["foreground", firstPrimary], ["foreground", secondPrimary]]);
  assert.equal(discovery, 2);
  assert.equal(rediscoveredDiagnostics[0].cacheHit, true);
  assert.equal(rediscoveredDiagnostics[0].cacheValid, false);
  assert.equal(rediscoveredDiagnostics[0].source, "discovery");
  assert.equal(rediscoveredDiagnostics[0].candidateCount, 2);
  assert.equal(rediscoveredDiagnostics[0].primaryCandidate, true);
});

test("Windows native focus does not cache an owned displayed-window fallback", async () => {
  clearWindowsFocusCache();
  const displayedFallback = 0x2001n;
  let foreground = 0xAAAAn;
  let discovery = 0;
  const api = {
    isWindow: () => true,
    processIdForWindow: () => 4211,
    isWindowCandidate: () => true,
    isPrimaryWindowCandidate: () => false,
    findWindowsForProcess: () => { discovery += 1; return [displayedFallback]; },
    getForegroundWindow: () => foreground,
    isZoomed: () => true,
    foreground: hwnd => { foreground = hwnd; return true; }
  };

  for (let index = 0; index < 2; index += 1) {
    foreground = 0xAAAAn;
    const diagnostics = [];
    await activateWindowsProcess(4211, {
      api,
      wait: async () => {},
      onDiagnostic: (stage, fields) => diagnostics.push({ stage, ...fields })
    });
    assert.equal(diagnostics[0].source, "discovery");
    assert.equal(diagnostics[0].primaryCandidate, false);
  }
  assert.equal(discovery, 2);
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
  const diagnostics = [];
  const api = {
    isWindow: () => true,
    processIdForWindow: () => 4203,
    findWindowForProcess: () => 0x2222n,
    getForegroundWindow: () => foreground,
    isZoomed: () => true,
    foreground: hwnd => { calls.push(["foreground", hwnd]); return false; },
    forceForeground: hwnd => {
      calls.push(["forceForeground", hwnd]);
      foreground = hwnd;
      return {
        foregroundAttach: "succeeded",
        targetAttach: "succeeded",
        bringToTopAccepted: true,
        setForegroundAccepted: false,
        setFocusReturnedWindow: true,
        detachAccepted: true
      };
    },
    flash: hwnd => calls.push(["flash", hwnd])
  };
  const waits = [];
  const result = await activateWindowsProcess(4203, {
    api,
    wait: async milliseconds => waits.push(milliseconds),
    onDiagnostic: (stage, fields) => diagnostics.push({ stage, ...fields })
  });
  assert.equal(result.alreadyMaximized, true);
  assert.deepEqual(calls, [["foreground", 0x2222n], ["forceForeground", 0x2222n]]);
  assert.deepEqual(waits, [25, 25]);
  const force = diagnostics.find(event => event.stage === "force-foreground");
  assert.equal(force?.foregroundAttach, "succeeded");
  assert.equal(force?.setForegroundAccepted, false);
  assert.equal(force?.setFocusReturnedWindow, true);
  assert.equal(
    diagnostics.find(event => event.stage === "verify-foreground-forced")?.matchesTarget,
    true
  );
});

test("Windows native focus uses aggressive input only when explicitly enabled", async () => {
  clearWindowsFocusCache();
  let foreground = 0x1111n;
  const calls = [];
  const waits = [];
  const diagnostics = [];
  const api = {
    isWindow: () => true,
    processIdForWindow: () => 4204,
    findWindowForProcess: () => 0x3333n,
    getForegroundWindow: () => foreground,
    isZoomed: () => true,
    foreground: () => false,
    forceForeground: () => ({
      foregroundAttach: "failed",
      targetAttach: "succeeded",
      bringToTopAccepted: true,
      setForegroundAccepted: false,
      setFocusReturnedWindow: false,
      detachAccepted: true
    }),
    aggressiveForeground: hwnd => {
      calls.push(["aggressiveForeground", hwnd]);
      foreground = hwnd;
      return {
        modifierStateClear: true,
        inputEventsInserted: 2,
        inputErrorCode: 0,
        releaseAccepted: true,
        setForegroundAccepted: true
      };
    }
  };

  await activateWindowsProcess(4204, {
    api,
    wait: async milliseconds => waits.push(milliseconds),
    onDiagnostic: (stage, fields) => diagnostics.push({ stage, ...fields }),
    forceFocus: true
  });

  assert.equal(
    diagnostics.find(event => event.stage === "initial-foreground")?.accepted,
    false
  );
  assert.equal(
    diagnostics.find(event => event.stage === "verify-foreground-forced")?.matchesTarget,
    false
  );
  assert.deepEqual(calls, [["aggressiveForeground", 0x3333n]]);
  assert.deepEqual(waits, [25, 25, 75, 150, 25]);
  assert.equal(diagnostics.find(event => event.stage === "aggressive-foreground")?.forceFocus, true);
  assert.equal(diagnostics.find(event => event.stage === "aggressive-foreground")?.inputEventsInserted, 2);
  assert.equal(
    diagnostics.find(event => event.stage === "verify-foreground-aggressive")?.matchesTarget,
    true
  );
  assert.doesNotMatch(JSON.stringify(diagnostics), /3333|4204|hwnd|pid|thread|title|path/i);
});

test("Windows native focus automatically uses aggressive input after access-denied attachment", async () => {
  clearWindowsFocusCache();
  let foreground = 0x1111n;
  const calls = [];
  const waits = [];
  const diagnostics = [];
  const api = {
    isWindow: () => true,
    processIdForWindow: () => 4206,
    findWindowForProcess: () => 0x5555n,
    getForegroundWindow: () => foreground,
    isZoomed: () => true,
    foreground: () => false,
    forceForeground: () => ({
      foregroundAttach: "failed",
      foregroundAttachErrorCode: 5,
      targetAttach: "succeeded",
      targetAttachErrorCode: 0,
      bringToTopAccepted: true,
      setForegroundAccepted: false,
      setFocusReturnedWindow: true,
      detachAccepted: true
    }),
    aggressiveForeground: hwnd => {
      calls.push(["aggressiveForeground", hwnd]);
      foreground = hwnd;
      return {
        modifierStateClear: true,
        inputEventsInserted: 2,
        inputErrorCode: 0,
        releaseAccepted: true,
        setForegroundAccepted: true
      };
    }
  };

  await activateWindowsProcess(4206, {
    api,
    wait: async milliseconds => waits.push(milliseconds),
    onDiagnostic: (stage, fields) => diagnostics.push({ stage, ...fields })
  });

  assert.deepEqual(calls, [["aggressiveForeground", 0x5555n]]);
  assert.deepEqual(waits, [25, 25, 25]);
  const aggressive = diagnostics.find(event => event.stage === "aggressive-foreground");
  assert.equal(aggressive?.automatic, true);
  assert.equal(aggressive?.forceFocus, false);
  assert.equal(aggressive?.inputEventsInserted, 2);
  assert.equal(
    diagnostics.find(event => event.stage === "verify-foreground-aggressive")?.matchesTarget,
    true
  );
  assert.doesNotMatch(JSON.stringify(diagnostics), /5555|4206|hwnd|pid|thread|title|path/i);
});

test("Windows native focus reports a bounded denial and requests finite taskbar attention", async () => {
  clearWindowsFocusCache();
  const diagnostics = [];
  let flashCalls = 0;
  const api = {
    isWindow: () => true,
    processIdForWindow: () => 4205,
    findWindowForProcess: () => 0x4444n,
    getForegroundWindow: () => 0x1111n,
    isZoomed: () => true,
    foreground: () => false,
    forceForeground: () => ({}),
    aggressiveForeground: () => { throw new Error("must stay disabled by default"); },
    flash: () => { flashCalls += 1; return false; }
  };

  await assert.rejects(
    activateWindowsProcess(4205, {
      api,
      wait: async () => {},
      onDiagnostic: (stage, fields) => diagnostics.push({ stage, ...fields })
    }),
    /Windows did not allow Codex Desktop to receive focus/
  );

  assert.equal(flashCalls, 1);
  assert.equal(diagnostics.find(event => event.stage === "final-attention")?.attentionRequested, true);
  assert.equal(diagnostics.find(event => event.stage === "final-attention")?.wasActiveBeforeAttention, false);
  assert.equal(diagnostics.find(event => event.stage === "final-denial")?.matchesTarget, false);
  assert.doesNotMatch(JSON.stringify(diagnostics), /4444|4205|hwnd|pid|thread|title|path/i);
});

test("task activation succeeds only when navigation and native focus both succeed", async () => {
  assert.deepEqual(await navigateAndFocus(
    async () => "navigated",
    async () => "focused"
  ), { focusOk: true, attentionRequested: false });
  await assert.rejects(
    navigateAndFocus(
      async () => "navigated",
      async () => { throw new Error("foreground denied"); }
    ),
    /foreground denied/
  );
  await assert.rejects(
    navigateAndFocus(
      async () => { throw new Error("navigation failed"); },
      async () => true
    ),
    /navigation failed/
  );
});

test("task activation verifies native navigation and falls back to a confirmed DOM activation", async () => {
  const client = new CodexCdpClient();
  const trace = createTraceFixture();
  const calls = [];
  const activeResults = [false, false];
  client.threadIsActive = async () => {
    calls.push(["active"]);
    return activeResults.shift();
  };
  client.dispatchAgent = async (slot, _threadKey, act) => calls.push(["agent", slot, act]);
  client.activateThread = async () => calls.push(["activate"]);
  client.waitForThreadActivation = async () => calls.push(["verify"]);

  await client.clickThreadKey("local:private-thread-fixture", 2, trace);

  assert.deepEqual(calls, [
    ["active"],
    ["agent", 2, 1],
    ["agent", 2, 0],
    ["active"],
    ["activate"],
    ["verify"]
  ]);
  assert.equal(trace.pending, 0);
  assert.ok(trace.events.some(event => event.stage === "task.native-act1" && event.outcome === "succeeded"));
  assert.ok(trace.events.some(event => event.stage === "task.native-act0" && event.outcome === "succeeded"));
  assert.ok(trace.events.some(event => event.stage === "task.dom-activate" && event.outcome === "succeeded"));
  assert.doesNotMatch(JSON.stringify(trace.events), /private-thread-fixture/);
});

test("task activation avoids dispatch when the requested task is already active", async () => {
  const client = new CodexCdpClient();
  client.threadIsActive = async () => true;
  client.dispatchAgent = async () => { throw new Error("must not dispatch"); };

  assert.equal(await client.clickThreadKey("local:active-thread", 0), true);
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

test("model presets identify semantic picker rows and ignore unrelated rows", async () => {
  const client = new CodexCdpClient();
  const clickStages = [];
  const effortOrder = ["low", "medium", "high", "xhigh", "max"];
  let currentModel = "5.6 Sol";
  let currentEffort = "medium";
  let expanded = false;

  client.evaluate = async (expression) => {
    if (expression.includes("function inspectModelPicker(")) return { modern: false };
    if (expression.includes('const triggers = [...document.querySelectorAll("[data-codex-intelligence-trigger]")].filter(visible)')) {
      return { text: currentModel, effort: currentEffort, expanded };
    }
    if (expression.includes("rowCount: menus[0]?.querySelectorAll")) {
      return { count: 0, expanded: true, rowCount: 3 };
    }
    if (expression.includes("return menu?.querySelectorAll") && expression.includes("length ?? 0")) {
      return 3;
    }
    throw new Error(`Unexpected model fixture expression: ${expression.slice(0, 80)}`);
  };
  client.waitForRenderer = async (_expression, description, _trace, stage) => {
    if (description === "Codex model picker submenu") {
      if (stage === "model.wait-submenu-1") {
        return ["5.6 Sol", "5.6 Luna"].map(text => ({ text, checked: text === currentModel }));
      }
      if (stage === "model.wait-submenu-2") {
        return ["Auto", "Manual"].map(text => ({ text, checked: false }));
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
  assert.equal(clickStages.filter(stage => stage === "model.open-row-3").length, 1);
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
  assert.equal(clickStages.filter(stage => stage === "model.open-row-3").length, 1);
  assert.ok(cachedTrace.events.some(event =>
    event.event === "model.rows-identified" && event.source === "cache"
  ));

  client.disconnect();
  await client.dispatchModelPreset("model-luna-max", createTraceFixture());
  assert.equal(clickStages.filter(stage => stage === "model.open-row-1").length, 2);
  assert.equal(clickStages.filter(stage => stage === "model.open-row-2").length, 2);
  assert.equal(clickStages.filter(stage => stage === "model.open-row-3").length, 2);
});

test("model presets fail closed when semantic picker rows are ambiguous", async () => {
  const client = new CodexCdpClient();
  const effortOrder = ["low", "medium", "high", "xhigh", "max"];
  let expanded = false;

  client.evaluate = async (expression) => {
    if (expression.includes("function inspectModelPicker(")) return { modern: false };
    if (expression.includes('const triggers = [...document.querySelectorAll("[data-codex-intelligence-trigger]")].filter(visible)')) {
      return { text: "5.6 Sol", effort: "medium", expanded };
    }
    if (expression.includes("rowCount: menus[0]?.querySelectorAll")) {
      return { count: 0, expanded: true, rowCount: 3 };
    }
    if (expression.includes("return menu?.querySelectorAll") && expression.includes("length ?? 0")) {
      return 3;
    }
    throw new Error(`Unexpected ambiguous model fixture expression: ${expression.slice(0, 80)}`);
  };
  client.waitForRenderer = async (_expression, description, _trace, stage) => {
    if (description === "Codex model picker submenu") {
      if (stage === "model.wait-submenu-3") {
        return effortOrder.map(text => ({ text, checked: text === "medium" }));
      }
      return ["5.6 Sol", "5.6 Luna"].map(text => ({ text, checked: false }));
    }
    return true;
  };
  client.clickRendererCandidates = async (_expression, _description, _trace, stage) => {
    if (stage === "model.open-trigger") expanded = true;
  };
  client.pressRendererEscape = async () => { expanded = false; };

  await assert.rejects(
    client.dispatchModelPreset("model-luna-max", createTraceFixture()),
    /Expected one Codex model row for 5\.6 Luna, found 2/
  );
  assert.equal(client.modelPickerLayout, null);
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
