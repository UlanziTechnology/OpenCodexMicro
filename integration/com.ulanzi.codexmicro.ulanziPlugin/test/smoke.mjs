import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";

const packageRootUrl = new URL("..", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", packageRootUrl)));
const pluginBundleSource = await readFile(new URL("dist/app.js", packageRootUrl), "utf8");
const bundledBridgeSource = await readFile(new URL("installer/bridge.mjs", packageRootUrl));
const bundledBridgeHash = createHash("sha256")
  .update(bundledBridgeSource)
  .digest("hex");
const navigateAction = manifest.Actions.find(action =>
  action.UUID === "com.ulanzi.ulanzistudio.codexmicro.navigate"
);
assert.deepEqual(navigateAction?.Controllers, ["Encoder"]);
assert.equal(navigateAction?.Encoder?.layout, "$UA1");
assert.equal(navigateAction?.Icon, "assets/icons/task-idle.svg");
assert.equal(navigateAction?.States?.[0]?.Image, "assets/icons/task-idle.svg");
assert.equal(manifest.Version, "0.6.1");
assert.match(String(bundledBridgeSource), /BRIDGE_VERSION = .*"0\.6\.1"/);
assert.doesNotMatch(String(bundledBridgeSource), /process\.env\.CODEX_BRIDGE_VERSION/);
assert.match(pluginBundleSource, /scheduleBridgeReconcileRetry\(\);/);
assert.match(pluginBundleSource, /bridgeReconcilePromise === running\) bridgeReconcilePromise = null/);
assert.equal(manifest.Software?.MinVersion, "3.0.1");
assert.equal(manifest.OS?.find(item => item.Platform === "mac")?.MinimumVersion, "13.0");
assert.equal(manifest.OS?.find(item => item.Platform === "windows")?.MinimumVersion, "10.0");
const taskActions = manifest.Actions.filter(action => /\.task[1-5]$/.test(action.UUID));
assert.ok(taskActions.every(action => action.Icon === "assets/icons/task-idle.svg"));
assert.ok(taskActions.every(action => action.States?.[0]?.Image === "assets/icons/task-idle.svg"));
assert.ok((await readFile(new URL("assets/icons/task-idle.svg", packageRootUrl))).length > 0);
assert.ok(
  manifest.Actions.every(action => action.PropertyInspectorPath === "property-inspector/setup.html"),
  "every action must expose the shared Bridge setup inspector"
);
const modelActions = manifest.Actions.slice(-3);
assert.deepEqual(
  modelActions.map(action => action.UUID),
  [
    "com.ulanzi.ulanzistudio.codexmicro.model-sol-high",
    "com.ulanzi.ulanzistudio.codexmicro.model-luna-max",
    "com.ulanzi.ulanzistudio.codexmicro.model-sol-medium"
  ]
);
for (const action of modelActions) {
  assert.deepEqual(action.Controllers, ["Keypad"]);
  assert.equal(action.DisableAutomaticStates, true);
  assert.equal(action.States?.[0]?.Image, action.Icon);
  assert.ok((await readFile(new URL(action.Icon, packageRootUrl))).length > 0, `${action.Icon} must exist`);
}
const setupInspector = await readFile(new URL("property-inspector/setup.html", packageRootUrl), "utf8");
assert.match(setupInspector, /Codex Bridge Setup/);
assert.match(setupInspector, /Install \/ Repair/);
assert.match(setupInspector, /bridgeSetup/);
const setupScript = setupInspector.match(/<script>([\s\S]*)<\/script>/)?.[1];
assert.ok(setupScript, "setup inspector must contain its client script");
assert.doesNotThrow(() => new Function(setupScript), "setup inspector script must parse");
for (const asset of [
  "installer/bridge.mjs",
  "installer/CodexBridge.png",
  "installer/LICENSE",
  "installer/NOTICE.md",
  "installer/THIRD_PARTY_NOTICES.md"
]) {
  assert.ok((await readFile(new URL(asset, packageRootUrl))).length > 0, `${asset} must be bundled`);
}
for (const banner of manifest.Banner || []) {
  assert.ok((await readFile(new URL(banner, packageRootUrl))).length > 0, `${banner} must be bundled`);
}
assert.match(manifest.Overview, /Ulanzi D200 Series/);
assert.match(manifest.Description, /MANUAL INSTALLATION/);
assert.match(manifest.Description, /Latest Task & Scroll Encoder/);
assert.match(manifest.Description, /Windows 10/);
assert.match(manifest.Description, /Stable or Beta/);
assert.match(manifest.Description, /does not use a version-pinned WindowsApps path/i);

const localizedActionNames = {
  "en.json": ["Codex Task 1", "Latest Task & Scroll", "Submit to Codex"],
  "zh_CN.json": ["Codex 任务 1", "最新任务与滚动", "提交到 Codex"],
  "zh_HK.json": ["Codex 任務 1", "最新任務與捲動", "提交至 Codex"],
  "ja_JP.json": ["Codex タスク 1", "最新タスクとスクロール", "Codex に送信"],
  "de_DE.json": ["Codex-Aufgabe 1", "Letzte Aufgabe & Scrollen", "An Codex senden"],
  "ko_KR.json": ["Codex 작업 1", "최신 작업 및 스크롤", "Codex에 제출"],
  "pt_PT.json": ["Tarefa Codex 1", "Tarefa recente e deslocamento", "Enviar para o Codex"],
  "es_ES.json": ["Tarea Codex 1", "Tarea reciente y desplazamiento", "Enviar a Codex"]
};
const localizedModelActionNames = {
  "en.json": ["Codex Sol High", "Codex Luna Max", "Codex Sol Medium"],
  "zh_CN.json": ["Codex Sol 高", "Codex Luna 最高", "Codex Sol 中"],
  "zh_HK.json": ["Codex Sol 高", "Codex Luna 最高", "Codex Sol 中"],
  "ja_JP.json": ["Codex Sol High", "Codex Luna Max", "Codex Sol Medium"],
  "de_DE.json": ["Codex Sol Hoch", "Codex Luna Maximum", "Codex Sol Mittel"],
  "ko_KR.json": ["Codex Sol 높음", "Codex Luna 최대", "Codex Sol 중간"],
  "pt_PT.json": ["Codex Sol Alto", "Codex Luna Máximo", "Codex Sol Médio"],
  "es_ES.json": ["Codex Sol Alto", "Codex Luna Máximo", "Codex Sol Medio"]
};

for (const locale of [
  "en.json",
  "zh_CN.json",
  "zh_HK.json",
  "ja_JP.json",
  "de_DE.json",
  "ko_KR.json",
  "pt_PT.json",
  "es_ES.json"
]) {
  const messages = JSON.parse(await readFile(new URL(locale, packageRootUrl)));
  assert.equal(messages.Name, "Codex Micro", `${locale} must localize Name`);
  assert.ok(messages.Overview?.length > 20, `${locale} must localize Overview`);
  assert.match(messages.Description, /npm run install:plugin/);
  assert.match(messages.Description, /npm run setup/);
  assert.doesNotMatch(messages.Description, /Codex Bridge\.app/);
  assert.ok(messages.Localization?.BridgeSetup?.length > 0, `${locale} must localize the setup page`);
  assert.ok(messages.Localization?.InstallRepair?.length > 0, `${locale} must localize Bridge installation`);
  assert.ok(messages.Localization?.UninstallBridge?.length > 0, `${locale} must localize Bridge uninstallation`);
  assert.ok(messages.Localization?.BridgeAppInfoTitle?.length > 0, `${locale} must explain Codex Bridge.app`);
  assert.ok(messages.Localization?.BackgroundActivityTitle?.length > 0, `${locale} must explain background activity`);
  assert.ok(messages.Localization?.NodeSelectionStrategy?.length > 0, `${locale} must explain Node selection`);
  assert.ok(messages.Localization?.UlanziNodeSignatureNotice?.length > 0, `${locale} must explain the Ulanzi Node signature`);
  assert.equal(messages.Actions?.length, manifest.Actions.length, `${locale} must localize every action`);
  assert.ok(
    messages.Actions.every(action => action.Name?.length > 0 && action.Tooltip?.length > 0),
    `${locale} must localize every action name and tooltip`
  );
  assert.deepEqual(
    [messages.Actions[0].Name, messages.Actions[9].Name, messages.Actions[13].Name],
    localizedActionNames[locale],
    `${locale} action localization must follow manifest action order`
  );
  assert.deepEqual(
    messages.Actions.slice(-3).map(action => action.Name),
    localizedModelActionNames[locale],
    `${locale} must localize all model presets in manifest order`
  );
  assert.equal(messages.Localization.BridgeApp, "Codex Bridge");
  assert.doesNotMatch(messages.Localization.BridgeAppDescription, /Codex Bridge\.app/);
}

const bridgeRequests = [];
const bridgeTraceRoutes = new Map();
const bridge = createServer((request, response) => {
  bridgeRequests.push(`${request.method} ${request.url}`);
  const traceId = String(request.headers["x-codex-trace-id"] || "");
  if (traceId && request.url !== "/diagnostics/trace") {
    bridgeTraceRoutes.set(traceId, request.url?.startsWith("/thread/") ? "thread-click" : "action");
  }
  response.setHeader("Content-Type", "application/json");
  if (request.url === "/health") {
    response.end(JSON.stringify({
      ok: true,
      bridgeVersion: manifest.Version,
      runtimeHash: bundledBridgeHash,
      codexConnected: true,
      updatedAt: Date.now()
    }));
    return;
  }
  if (request.url === "/state") {
    response.end(JSON.stringify({
      connected: true,
      slots: [
        { id: 0, threadKey: "11111111-1111-1111-1111-111111111111", title: "排查 PowerShell 配置与完整路径和多窗口激活问题", status: "thinking" },
        { id: 1, threadKey: "22222222-2222-2222-2222-222222222222", title: "A&B <C> \"D\" 'E'", status: "unread" },
        { id: 2, threadKey: "33333333-3333-3333-3333-333333333333", title: "Input task", status: "input" },
        { id: 3, threadKey: "44444444-4444-4444-4444-444444444444", title: "Failed task", status: "error" },
        { id: 4, threadKey: "55555555-5555-5555-5555-555555555555", title: "Idle task", status: "idle" }
      ],
      usage: { windows: [{ kind: "weekly", remainingPercent: 23 }] }
    }));
    return;
  }
  if (request.url === "/diagnostics/trace") {
    const route = bridgeTraceRoutes.get(traceId);
    response.end(JSON.stringify({
      ok: true,
      diagnostics: {
        traceId,
        complete: true,
        events: route === "thread-click"
          ? [
              { event: "server.request", offsetMs: 0, route, slot: 1 },
              { event: "cdp.stage", offsetMs: 12, stage: "focus.bring-to-front", outcome: "succeeded", durationMs: 4 },
              { event: "cdp.stage", offsetMs: 51, stage: "task.dom-activate", outcome: "succeeded", durationMs: 9, background: true }
            ]
          : [
              { event: "server.request", offsetMs: 0, route, action: "model-sol-high", phase: "down" },
              { event: "renderer.poll", offsetMs: 173, stage: "model.wait-main-menu", outcome: "succeeded", attempts: 4, durationMs: 173 }
            ]
      }
    }));
    return;
  }
  if (request.url === "/action/model-sol-medium/down") {
    response.statusCode = 500;
    response.end(JSON.stringify({
      ok: false,
      error: "Authorization Bearer synthetic-secret; task title: private user text"
    }));
    return;
  }
  response.end(JSON.stringify({ ok: true, bridge: true }));
});
await new Promise(resolve => bridge.listen(0, "127.0.0.1", resolve));
const bridgePort = bridge.address().port;

const host = new WebSocketServer({ host: "127.0.0.1", port: 0 });
await new Promise(resolve => host.once("listening", resolve));
const hostPort = host.address().port;
const messages = [];

const nodeBinary = process.env.PLUGIN_NODE_BINARY || process.execPath;
const pluginRoot = process.env.PLUGIN_RUNTIME_ROOT || new URL("..", import.meta.url);
const child = spawn(nodeBinary, ["dist/app.js", "127.0.0.1", String(hostPort), "en-US", "3.0.0"], {
  cwd: pluginRoot,
  env: {
    ...process.env,
    CODEX_BRIDGE_URL: `http://127.0.0.1:${bridgePort}`,
    CODEX_BRIDGE_AUTOSTART: "0"
  },
  stdio: ["ignore", "pipe", "pipe"]
});
const childStdout = [];
const childStderr = [];
child.stdout.on("data", chunk => childStdout.push(String(chunk)));
child.stderr.on("data", chunk => childStderr.push(String(chunk)));

try {
  const client = await new Promise((resolve, reject) => {
    host.once("connection", resolve);
    child.once("error", reject);
    child.once("exit", code => reject(new Error(`Plugin exited before connecting with code ${code}: ${child.stderr.read() || "no stderr"}`)));
  });
  client.on("message", raw => messages.push(JSON.parse(String(raw))));
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(messages[0]?.cmd, "connected");

  client.send(JSON.stringify({
    cmd: "sendToPlugin",
    uuid: "com.ulanzi.ulanzistudio.codexmicro.task1",
    actionid: "setup-action",
    key: "0_0",
    payload: { type: "bridgeSetup", action: "status" }
  }));
  await new Promise(resolve => setTimeout(resolve, 150));
  const setupStatus = messages.find(message =>
    message.cmd === "sendToPropertyInspector" &&
    message.actionid === "setup-action" &&
    message.payload?.type === "bridgeSetupStatus"
  );
  assert.equal(setupStatus?.payload?.status?.serviceOnline, true);
  assert.equal(setupStatus?.payload?.status?.cdpConnected, true);
  assert.equal(setupStatus?.payload?.status?.bundledVersion, "0.6.1");
  assert.equal(setupStatus?.payload?.status?.serviceVersion, "0.6.1");
  assert.equal(setupStatus?.payload?.status?.serviceRuntimeHash, bundledBridgeHash);

  const taskColors = [
    ["#2589f5"],
    ["#28b875", "#6ce9a6"],
    ["#ed9f20"],
    ["#e34d62"],
    ["#98a2b3"]
  ];
  for (let index = 0; index < taskColors.length; index += 1) {
    client.send(JSON.stringify({
      cmd: "add",
      uuid: `com.ulanzi.ulanzistudio.codexmicro.task${index + 1}`,
      actionid: `a${index + 1}`,
      key: `0_${index}`,
      param: {}
    }));
  }
  await new Promise(resolve => setTimeout(resolve, 1200));
  const taskSvgs = [];
  const taskItems = [];
  for (let index = 0; index < taskColors.length; index += 1) {
    const taskUuid = `com.ulanzi.ulanzistudio.codexmicro.task${index + 1}`;
    const state = messages.find(message =>
      message.cmd === "state" && message.param?.statelist?.[0]?.uuid === taskUuid
    );
    const item = state?.param?.statelist?.[0];
    taskItems.push(item);
    assert.equal(item?.type, 1);
    assert.match(item?.data || "", /^data:image\/svg\+xml;base64,/);
    assert.equal(item?.showtext, true);
    assert.equal(item?.textData, item?.textdata);
    assert.ok(item?.textData.length > 0);
    assert.equal(Object.hasOwn(item || {}, "path"), false);
    assert.equal(Object.hasOwn(item || {}, "gifpath"), false);
    assert.equal(Object.hasOwn(item || {}, "state"), false, "task icon update must not send a state index");
    const svg = Buffer.from(item.data.split(",")[1], "base64").toString();
    taskSvgs.push(svg);
    assert.ok(
      taskColors[index].some(color => svg.includes(color)),
      `task ${index + 1} must use its status palette`
    );
    assert.match(svg, /width="196" height="196"/);
    assert.match(svg, /data-role="title-surface"/);
    assert.doesNotMatch(svg, /<text\b/);
  }
  const balancedLines = taskItems[0].textData.split("\n");
  assert.equal(balancedLines.length, 4, "long mixed title must render on exactly four lines");
  assert.ok(balancedLines.every(line => line.length > 0));
  const visibleUnits = line => Array.from(line).reduce((total, character) =>
    total + (/[\u2e80-\ua4cf\uac00-\ud7af\uf900-\ufaff]/u.test(character) ? 2 : character === " " ? 0.5 : 1), 0
  );
  assert.ok(balancedLines.every(line => visibleUnits(line) <= 10), "every title line must preserve horizontal margins");
  assert.match(balancedLines[3], /…$/, "truncated title must add an ellipsis to the fourth line");
  assert.equal(taskItems[1].textData, "A&B <C> \"D\n\" 'E'");
  const completeStates = messages.filter(message =>
    message.cmd === "state" &&
    message.param?.statelist?.[0]?.uuid === "com.ulanzi.ulanzistudio.codexmicro.task2"
  );
  const completeSvgs = completeStates.map(message =>
    Buffer.from(message.param.statelist[0].data.split(",")[1], "base64").toString()
  );
  assert.ok(completeSvgs.some(svg => svg.includes("#28b875")), "complete state must include the base green frame");
  assert.ok(completeSvgs.some(svg => svg.includes("#6ce9a6")), "complete state must flash to the bright green frame");

  for (let index = 0; index < taskColors.length; index += 1) {
    const event = {
      uuid: `com.ulanzi.ulanzistudio.codexmicro.task${index + 1}`,
      actionid: `a${index + 1}`,
      key: `0_${index}`,
      param: {}
    };
    client.send(JSON.stringify({ cmd: "keydown", ...event }));
    client.send(JSON.stringify({ cmd: "run", ...event }));
    client.send(JSON.stringify({ cmd: "keyup", ...event }));
  }
  await new Promise(resolve => setTimeout(resolve, 150));
  for (let index = 0; index < taskColors.length; index += 1) {
    const digit = String(index + 1);
    const threadKey = `${digit.repeat(8)}-${digit.repeat(4)}-${digit.repeat(4)}-${digit.repeat(4)}-${digit.repeat(12)}`;
    const threadRequests = bridgeRequests.filter(item => item.includes(`/thread/${threadKey}/click?slot=${index}`));
    assert.equal(threadRequests.length, 1, `task ${index + 1} run must not duplicate its keydown invocation`);
    const taskLogs = messages.filter(message =>
      message.cmd === "logMessage" && message.message?.includes(`name=task-${index + 1}`)
    );
    assert.ok(taskLogs.every(message =>
      message.uuid === "com.ulanzi.ulanzistudio.codexmicro" &&
      message.actionid === "" &&
      message.key === ""
    ), "Studio log messages must use the main-service identity");
    assert.ok(taskLogs.some(message => /event=received .*phase=down .*target=slot-[1-5]/.test(message.message)));
    assert.ok(taskLogs.some(message => /event=dispatching .*phase=down .*transport=bridge-http/.test(message.message)));
    assert.ok(taskLogs.some(message => /event=succeeded .*phase=down .*durationMs=\d+/.test(message.message)));
    assert.ok(taskLogs.some(message => /event=ignored .*phase=up .*reason=keydown-only/.test(message.message)));
  }

  const navigateEvent = {
    uuid: "com.ulanzi.ulanzistudio.codexmicro.navigate",
    actionid: "action-navigate",
    key: "Encoder_0",
    param: {}
  };
  client.send(JSON.stringify({ cmd: "add", ...navigateEvent }));
  client.send(JSON.stringify({ cmd: "dialdown", ...navigateEvent }));
  client.send(JSON.stringify({ cmd: "dialup", ...navigateEvent }));
  client.send(JSON.stringify({ cmd: "dialrotate", rotateEvent: "left", ...navigateEvent }));
  client.send(JSON.stringify({ cmd: "dialrotate", rotateEvent: "right", ...navigateEvent }));
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(
    bridgeRequests.filter(item => item.includes("/thread/11111111-1111-1111-1111-111111111111/click?slot=0")).length,
    2,
    "Encoder press must open task slot 1"
  );
  assert.deepEqual(
    messages.filter(message => message.cmd === "hotkey").map(message => message.keylist),
    ["SCROLL UP", "SCROLL DOWN"]
  );
  const navigateState = messages.find(message =>
    message.cmd === "state" &&
    message.param?.statelist?.[0]?.uuid === navigateEvent.uuid
  );
  const navigateItem = navigateState?.param?.statelist?.[0];
  assert.equal(navigateItem?.type, 1);
  assert.equal(navigateItem?.showtext, true);
  assert.equal(navigateItem?.textData, navigateItem?.textdata);
  assert.match(navigateItem?.textData || "", /排查/);
  const navigateSvg = Buffer.from(navigateItem.data.split(",")[1], "base64").toString();
  assert.match(navigateSvg, /#2589f5/);
  assert.doesNotMatch(navigateSvg, /<text\b/);

  const actions = [
    "fast", "pin", "new", "fork", "steer", "mic", "submit",
    "model-sol-high", "model-luna-max", "model-sol-medium"
  ];
  for (const [index, action] of actions.entries()) {
    const uuid = `com.ulanzi.ulanzistudio.codexmicro.${action}`;
    const event = { uuid, actionid: `action-${action}`, key: `1_${index}`, param: {} };
    client.send(JSON.stringify({ cmd: "add", ...event }));
    client.send(JSON.stringify({ cmd: "keydown", ...event }));
    client.send(JSON.stringify({ cmd: "run", ...event }));
    client.send(JSON.stringify({ cmd: "keyup", ...event }));
  }
  const usageEvent = {
    uuid: "com.ulanzi.ulanzistudio.codexmicro.usage",
    actionid: "action-usage",
    key: "2_0",
    param: {}
  };
  client.send(JSON.stringify({ cmd: "add", ...usageEvent }));
  client.send(JSON.stringify({ cmd: "keydown", ...usageEvent }));
  client.send(JSON.stringify({ cmd: "run", ...usageEvent }));
  client.send(JSON.stringify({ cmd: "keyup", ...usageEvent }));
  await new Promise(resolve => setTimeout(resolve, 250));

  for (const action of actions) {
    assert.equal(
      bridgeRequests.filter(item => item === `POST /action/${action}/down`).length,
      1,
      `${action} must execute once on keydown`
    );
    assert.equal(
      bridgeRequests.filter(item => item === `POST /action/${action}/up`).length,
      1,
      `${action} must preserve keyup`
    );
  }
  for (const action of ["model-sol-high", "model-luna-max", "model-sol-medium"]) {
    const actionLogs = messages.filter(message =>
      message.cmd === "logMessage" && message.message?.includes(`name=${action}`)
    );
    assert.ok(actionLogs.some(message => /event=received .*phase=down .*target=model-gpt-5\.6-(?:sol|luna) effort-(?:high|max|medium)/.test(message.message)));
    assert.ok(actionLogs.some(message => /event=dispatching .*phase=down .*transport=bridge-http/.test(message.message)));
    assert.ok(actionLogs.some(message => /phase=up/.test(message.message)), `${action} must log keyup`);
  }
  const failedPresetLog = messages.find(message =>
    message.cmd === "logMessage" &&
    message.level === "error" &&
    message.message?.includes("name=model-sol-medium") &&
    message.message?.includes("event=failed")
  );
  assert.match(failedPresetLog?.message || "", /category=bridge-rejected/);
  const serializedLogs = JSON.stringify(messages.filter(message => message.cmd === "logMessage"));
  assert.match(serializedLogs, /bridgeEvent=cdp\.stage/);
  assert.match(serializedLogs, /stage=focus\.bring-to-front/);
  assert.match(serializedLogs, /stage=task\.dom-activate/);
  assert.match(serializedLogs, /bridgeEvent=renderer\.poll/);
  assert.match(serializedLogs, /stage=model\.wait-main-menu/);
  assert.ok([...bridgeTraceRoutes.keys()].every(traceId => /^[a-f0-9-]{36}$/.test(traceId)));
  assert.doesNotMatch(serializedLogs, /synthetic-secret|private user text|11111111-1111-1111-1111-111111111111/);
  const serializedConsole = `${childStdout.join("")}\n${childStderr.join("")}`;
  for (const shortcut of [
    "task-1", "task-2", "task-3", "task-4", "task-5",
    "model-sol-high", "model-luna-max", "model-sol-medium"
  ]) {
    assert.match(serializedConsole, new RegExp(`shortcut event=.*name=${shortcut}`));
  }
  assert.doesNotMatch(serializedConsole, /synthetic-secret|private user text|11111111-1111-1111-1111-111111111111/);
  assert.equal(
    bridgeRequests.filter(item => item === "POST /focus").length,
    1,
    "Usage must focus Codex once on keydown"
  );
  const usageState = messages.find(message =>
    message.cmd === "state" &&
    message.param?.statelist?.[0]?.uuid === usageEvent.uuid
  );
  const usageItem = usageState?.param?.statelist?.[0];
  assert.equal(usageItem?.type, 1);
  assert.equal(usageItem?.showtext, true);
  assert.equal(usageItem?.textdata, "USAGE");
  assert.match(usageItem?.data || "", /^data:image\/svg\+xml;base64,/);
  const usageSvg = Buffer.from(usageItem.data.split(",")[1], "base64").toString();
  assert.match(usageSvg, />23<tspan/);
  assert.match(usageSvg, /#e89b2d/);
  process.stdout.write("Codex Micro plugin smoke test passed.\n");
} finally {
  child.kill("SIGTERM");
  host.close();
  bridge.close();
}
