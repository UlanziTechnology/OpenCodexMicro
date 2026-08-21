import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";

const packageRootUrl = new URL("..", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", packageRootUrl)));
const navigateAction = manifest.Actions.find(action =>
  action.UUID === "com.ulanzi.ulanzistudio.codexmicro.navigate"
);
assert.deepEqual(navigateAction?.Controllers, ["Encoder"]);
assert.equal(navigateAction?.Encoder?.layout, "$UA1");
assert.equal(manifest.Version, "0.6.0");
assert.equal(manifest.Software?.MinVersion, "3.0.1");
assert.equal(manifest.OS?.find(item => item.Platform === "mac")?.MinimumVersion, "13.0");
assert.equal(manifest.OS?.find(item => item.Platform === "windows")?.MinimumVersion, "10.0");
const completeGif = await readFile(new URL("assets/icons/task-complete.gif", packageRootUrl));
assert.equal(completeGif.subarray(0, 6).toString("ascii"), "GIF89a");
assert.ok(completeGif.length > 0, "animated complete task icon must be packaged");
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
const bridge = createServer((request, response) => {
  bridgeRequests.push(`${request.method} ${request.url}`);
  response.setHeader("Content-Type", "application/json");
  if (request.url === "/health") {
    response.end(JSON.stringify({ ok: true, codexConnected: true, updatedAt: Date.now() }));
    return;
  }
  if (request.url === "/state") {
    response.end(JSON.stringify({
      connected: true,
      slots: [
        { id: 0, threadKey: "11111111-1111-1111-1111-111111111111", title: "排查 PowerShell 配置与完整路径问题", status: "thinking" },
        { id: 1, threadKey: "22222222-2222-2222-2222-222222222222", title: "A&B <C> \"D\" 'E'", status: "unread" },
        { id: 2, threadKey: "33333333-3333-3333-3333-333333333333", title: "Input task", status: "input" },
        { id: 3, threadKey: "44444444-4444-4444-4444-444444444444", title: "Failed task", status: "error" },
        { id: 4, threadKey: "55555555-5555-5555-5555-555555555555", title: "Idle task", status: "idle" }
      ],
      usage: { windows: [{ kind: "weekly", remainingPercent: 23 }] }
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
  assert.equal(setupStatus?.payload?.status?.bundledVersion, "0.6.0");

  const taskColors = [
    "#2589f5",
    "#28b875",
    "#ed9f20",
    "#e34d62",
    "#667085"
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
  await new Promise(resolve => setTimeout(resolve, 700));
  const taskSvgs = [];
  for (let index = 0; index < taskColors.length; index += 1) {
    const taskUuid = `com.ulanzi.ulanzistudio.codexmicro.task${index + 1}`;
    const state = messages.find(message =>
      message.cmd === "state" && message.param?.statelist?.[0]?.uuid === taskUuid
    );
    const item = state?.param?.statelist?.[0];
    assert.equal(item?.type, 1);
    assert.match(item?.data || "", /^data:image\/svg\+xml;base64,/);
    assert.equal(item?.showtext, false);
    assert.equal(item?.textdata, "");
    assert.equal(Object.hasOwn(item || {}, "path"), false);
    assert.equal(Object.hasOwn(item || {}, "gifpath"), false);
    assert.equal(Object.hasOwn(item || {}, "state"), false, "task icon update must not send a state index");
    const svg = Buffer.from(item.data.split(",")[1], "base64").toString();
    taskSvgs.push(svg);
    assert.match(svg, new RegExp(taskColors[index]));
    assert.match(svg, /width="196" height="196"/);
    assert.match(svg, /text-anchor="middle"/);
  }
  const balancedLines = Array.from(taskSvgs[0].matchAll(/<tspan[^>]*>(.*?)<\/tspan>/g), match => match[1]);
  assert.equal(balancedLines.length, 2, "long mixed title must render on exactly two lines");
  assert.ok(balancedLines.every(line => line.length > 0));
  const visibleUnits = line => Array.from(line).reduce((total, character) =>
    total + (/[\u2e80-\ua4cf\uac00-\ud7af\uf900-\ufaff]/u.test(character) ? 2 : character === " " ? 0.5 : 1), 0
  );
  assert.ok(
    Math.abs(visibleUnits(balancedLines[0]) - visibleUnits(balancedLines[1])) <= 3,
    "mixed-language title lines must have similar visual widths"
  );
  assert.match(balancedLines[1], /…$/, "truncated title must add an ellipsis to the second line");
  assert.match(taskSvgs[1], /A&amp;B/);
  assert.match(taskSvgs[1], /&lt;C&gt;/);
  assert.match(taskSvgs[1], /&quot;D&quot;/);
  assert.match(taskSvgs[1], /&apos;E&apos;/);
  assert.doesNotMatch(taskSvgs[1], /<C>/);

  client.send(JSON.stringify({ cmd: "keydown", uuid: "com.ulanzi.ulanzistudio.codexmicro.task1", actionid: "a1", key: "0_0", param: {} }));
  client.send(JSON.stringify({ cmd: "run", uuid: "com.ulanzi.ulanzistudio.codexmicro.task1", actionid: "a1", key: "0_0", param: {} }));
  client.send(JSON.stringify({ cmd: "keyup", uuid: "com.ulanzi.ulanzistudio.codexmicro.task1", actionid: "a1", key: "0_0", param: {} }));
  await new Promise(resolve => setTimeout(resolve, 150));
  const threadRequests = bridgeRequests.filter(item => item.includes("/thread/11111111-1111-1111-1111-111111111111/click?slot=0"));
  assert.equal(threadRequests.length, 1, "run must not duplicate a keydown task invocation");

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
  assert.equal(navigateItem?.showtext, false);
  assert.equal(navigateItem?.textdata, "");
  const navigateSvg = Buffer.from(navigateItem.data.split(",")[1], "base64").toString();
  assert.match(navigateSvg, /#2589f5/);
  assert.match(navigateSvg, /排查/);

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
