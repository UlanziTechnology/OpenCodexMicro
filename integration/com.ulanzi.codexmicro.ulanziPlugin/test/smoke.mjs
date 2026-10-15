import "../../../test/helpers/env.mjs";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { hasSelectedApproval } from "../plugin/approval-state.js";

const approvalState = {
  connected: true,
  activeThreadKey: "current",
  attentionCount: 9,
  slots: [{ threadKey: "local:current", status: "idle" }, { threadKey: "local:other", status: "awaiting-approval" }]
};
for (const status of ["idle", "thinking", "error", "input", "attention", "awaiting-response", "unread"]) {
  assert.equal(hasSelectedApproval({ ...approvalState, slots: [{ ...approvalState.slots[0], status }, approvalState.slots[1]] }), false, `${status} must not enable approval, even with pending attention elsewhere`);
}
for (const status of ["approval", "awaiting-approval"]) {
  const state = { ...approvalState, slots: [{ threadKey: "local:current", status }] };
  assert.equal(hasSelectedApproval(state), true);
  assert.equal(hasSelectedApproval({ ...state, activeThreadKey: "local:current" }), true);
  assert.equal(hasSelectedApproval({ ...state, activeThreadKey: "other" }), false);
  assert.equal(hasSelectedApproval({ ...state, connected: false }), false);
  assert.equal(hasSelectedApproval({ ...state, activeThreadKey: null }), false);
}
assert.equal(hasSelectedApproval({ ...approvalState, slots: [], activeTasks: [{ threadId: "current", status: "awaiting-approval" }] }), true);
assert.equal(hasSelectedApproval({ ...approvalState, activeTasks: [{ threadId: "current", status: "awaiting-approval" }] }), false, "Current slot status must take precedence over stale activeTasks");
const selectedAlias = { threadKey: "local:client-new-thread:temporary", selected: true, status: "awaiting-approval" };
assert.equal(hasSelectedApproval({ ...approvalState, slots: [selectedAlias] }), true);
assert.equal(hasSelectedApproval({ ...approvalState, slots: [selectedAlias, { ...selectedAlias, threadKey: "local:client-new-thread:other" }] }), false);
assert.equal(hasSelectedApproval({ ...approvalState, slots: [{ ...selectedAlias, threadKey: "local:other" }] }), false);

const packageRootUrl = new URL("..", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", packageRootUrl)));
const navigateAction = manifest.Actions.find(action =>
  action.UUID === "com.ulanzi.ulanzistudio.codexmicro.navigate"
);
assert.deepEqual(navigateAction?.Controllers, ["Encoder"]);
assert.equal(navigateAction?.Encoder?.layout, "$UA1");
assert.equal(manifest.Version, "0.4.1");
assert.equal(manifest.Software?.MinVersion, "3.0.1");
assert.equal(manifest.OS?.find(item => item.Platform === "mac")?.MinimumVersion, "13.0");
assert.ok(
  manifest.Actions.every(action => action.PropertyInspectorPath === "property-inspector/setup.html"),
  "every action must expose the shared Bridge setup inspector"
);
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
assert.match(manifest.Overview, /Ulanzi D200 Series/);
assert.match(manifest.Description, /INSTALLATION ENVIRONMENT/);
assert.match(manifest.Description, /LLM \/ AGENT INSTALLATION/);
assert.match(manifest.Description, /MANUAL INSTALLATION/);
assert.match(manifest.Description, /Latest Task & Scroll Encoder/);
assert.match(
  manifest.Description,
  /Install the Ulanzi Studio plugin for me: https:\/\/github\.com\/UlanziTechnology\/OpenCodexMicro#1-llm--agent-installation/
);
assert.match(manifest.Description, /always launch Codex through ~\/Applications\/Codex Bridge\.app/i);
assert.match(manifest.Description, /open ~\/Applications\/Codex\\ Bridge\.app$/);

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

const localizedInstallPrompts = {
  "en.json": "Install the Ulanzi Studio plugin for me:",
  "zh_CN.json": "替我安装一下UlanziStudio插件：",
  "zh_HK.json": "請替我安裝 Ulanzi Studio 外掛程式：",
  "ja_JP.json": "Ulanzi Studio プラグインをインストールしてください：",
  "de_DE.json": "Installiere bitte das Ulanzi-Studio-Plugin für mich:",
  "ko_KR.json": "Ulanzi Studio 플러그인을 설치해 주세요:",
  "pt_PT.json": "Instala o plugin do Ulanzi Studio por mim:",
  "es_ES.json": "Instálame el plugin de Ulanzi Studio:"
};

const llmInstallationLink =
  "https://github.com/UlanziTechnology/OpenCodexMicro#1-llm--agent-installation";

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
  assert.equal(messages.Name, "Codex App", `${locale} must localize Name`);
  assert.ok(messages.Overview?.length > 20, `${locale} must localize Overview`);
  assert.match(messages.Description, /https:\/\/github\.com\/UlanziTechnology\/OpenCodexMicro/);
  assert.match(messages.Description, /npm run install:plugin/);
  assert.match(messages.Description, /npm run setup/);
  assert.match(messages.Description, /Latest Task & Scroll/);
  assert.ok(messages.Localization?.BridgeSetup?.length > 0, `${locale} must localize the setup page`);
  assert.ok(messages.Localization?.InstallRepair?.length > 0, `${locale} must localize Bridge installation`);
  assert.ok(messages.Localization?.UninstallBridge?.length > 0, `${locale} must localize Bridge uninstallation`);
  assert.ok(messages.Localization?.BridgeAppInfoTitle?.length > 0, `${locale} must explain Codex Bridge.app`);
  assert.ok(messages.Localization?.BackgroundActivityTitle?.length > 0, `${locale} must explain background activity`);
  assert.ok(messages.Localization?.NodeSelectionStrategy?.length > 0, `${locale} must explain Node selection`);
  assert.ok(messages.Localization?.UlanziNodeSignatureNotice?.length > 0, `${locale} must explain the Ulanzi Node signature`);
  assert.ok(
    messages.Description.includes(`${localizedInstallPrompts[locale]}${
      locale.startsWith("zh_") || locale === "ja_JP.json" ? "" : " "
    }${llmInstallationLink}`),
    `${locale} must localize the anchored LLM installation prompt`
  );
  assert.equal(messages.Actions?.length, manifest.Actions.length, `${locale} must localize every action`);
  assert.ok(
    messages.Actions.every(action => action.Name?.length > 0 && action.Tooltip?.length > 0),
    `${locale} must localize every action name and tooltip`
  );
  assert.deepEqual(
    [messages.Actions[0].Name, messages.Actions[11].Name, messages.Actions[15].Name],
    localizedActionNames[locale],
    `${locale} action localization must follow manifest action order`
  );
  assert.match(
    messages.Description.split("\n\n").at(-1),
    /open ~\/Applications\/Codex\\ Bridge\.app$/,
    `${locale} must end with the Bridge launch command`
  );
}

const bridgeRequests = [];
let firstTaskStatus = "thinking";
let activeThreadKey = null;
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
      activeThreadKey,
      planAvailable: true,
      slots: [
        { id: 0, threadKey: "11111111-1111-1111-1111-111111111111", title: "Working task", status: firstTaskStatus, progress: { turnId: "turn-progress", completed: 2, total: 5, currentStep: "Validate <plan>" }, tokenUsage: { totalTokens: 987654 } },
        { id: 1, threadKey: "22222222-2222-2222-2222-222222222222", title: "Unread task", status: "unread" },
        { id: 2, threadKey: "33333333-3333-3333-3333-333333333333", title: "Input task", status: "input" },
        { id: 3, threadKey: "44444444-4444-4444-4444-444444444444", title: "Failed task", status: "error" },
        { id: 4, threadKey: "55555555-5555-5555-5555-555555555555", title: "Idle task", status: "idle" }
      ],
      activeTasks: [
        {
          threadKey: "11111111-1111-1111-1111-111111111111",
          threadId: "11111111-1111-1111-1111-111111111111",
          slot: 0,
          title: "Working task",
          status: "thinking",
          taskType: "WORK",
          model: "5.6 LUNA"
        }
      ],
      lastTask: {
        threadKey: "11111111-1111-1111-1111-111111111111",
        threadId: "11111111-1111-1111-1111-111111111111",
        slot: 0,
        title: "Working task",
        status: "thinking",
        taskType: "WORK",
        model: "5.6 LUNA"
      },
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
  env: { ...process.env, CODEX_BRIDGE_URL: `http://127.0.0.1:${bridgePort}` },
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
  assert.equal(setupStatus?.payload?.status?.bundledVersion, "0.4.1");

  const taskPaths = [
    "assets/icons/task-working.png",
    "assets/icons/task-complete.png",
    "assets/icons/task-attention.png",
    "assets/icons/task-error.png",
    "assets/icons/task-idle.png"
  ];
  for (let index = 0; index < taskPaths.length; index += 1) {
    client.send(JSON.stringify({
      cmd: "add",
      uuid: `com.ulanzi.ulanzistudio.codexmicro.task${index + 1}`,
      actionid: `a${index + 1}`,
      key: `0_${index}`,
      param: {}
    }));
  }
  await new Promise(resolve => setTimeout(resolve, 700));
  for (let index = 0; index < taskPaths.length; index += 1) {
    const taskUuid = `com.ulanzi.ulanzistudio.codexmicro.task${index + 1}`;
    const state = messages.find(message =>
      message.cmd === "state" && message.param?.statelist?.[0]?.uuid === taskUuid
    );
    const item = state?.param?.statelist?.[0];
    assert.equal(item?.type, 1);
    assert.match(item?.data || "", /^data:image\/svg\+xml;base64,/);
    assert.equal(item?.showtext, false);
    assert.equal(item?.textData, "");
  }

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
  assert.equal(messages.filter(message => message.cmd === "hotkey").length, 0);
  for (const direction of ["up", "down"]) {
    assert.ok(bridgeRequests.includes(`POST /joystick/${direction}/down`));
    assert.ok(bridgeRequests.includes(`POST /joystick/${direction}/up`));
  }
  const navigateState = messages.find(message =>
    message.cmd === "state" &&
    message.param?.statelist?.[0]?.uuid === navigateEvent.uuid
  );
  assert.equal(navigateState?.param?.statelist?.[0]?.type, 1);
  assert.match(navigateState?.param?.statelist?.[0]?.data || "", /^data:image\/svg\+xml;base64,/);

  const actions = ["fast", "pin", "new", "fork", "steer", "mic", "submit", "approve", "reject"];
  for (const [index, action] of actions.entries()) {
    const uuid = `com.ulanzi.ulanzistudio.codexmicro.${action}`;
    const event = { uuid, actionid: `action-${action}`, key: `1_${index}`, param: {} };
    client.send(JSON.stringify({ cmd: "add", ...event }));
    client.send(JSON.stringify({ cmd: "keydown", ...event }));
    client.send(JSON.stringify({ cmd: "run", ...event }));
    client.send(JSON.stringify({ cmd: "keyup", ...event }));
  }
  const modelEvent = { uuid: "com.ulanzi.ulanzistudio.codexmicro.model", actionid: "model-action", key: "2_9", param: {} };
  client.send(JSON.stringify({ cmd: "add", ...modelEvent }));
  client.send(JSON.stringify({ cmd: "keydown", ...modelEvent }));
  client.send(JSON.stringify({ cmd: "run", ...modelEvent }));
  client.send(JSON.stringify({ cmd: "keyup", ...modelEvent }));
  const planEvent = { uuid: "com.ulanzi.ulanzistudio.codexmicro.plan", actionid: "plan-action", key: "2_10", param: {} };
  client.send(JSON.stringify({ cmd: "add", ...planEvent }));
  client.send(JSON.stringify({ cmd: "keydown", ...planEvent }));
  client.send(JSON.stringify({ cmd: "run", ...planEvent }));
  client.send(JSON.stringify({ cmd: "keyup", ...planEvent }));
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

  assert.equal(bridgeRequests.filter(item => item === "POST /action/model/down").length, 1);
  assert.equal(bridgeRequests.filter(item => item === "POST /action/plan/down").length, 1);
  assert.equal(bridgeRequests.filter(item => item === "POST /action/plan/up").length, 0);
  assert.equal(bridgeRequests.filter(item => item === "POST /action/model/up").length, 0);
  for (const action of actions) {
    const bridgeAction = action;
    assert.equal(
      bridgeRequests.filter(item => item === `POST /action/${bridgeAction}/down`).length,
      1,
      `${action} must execute once on keydown`
    );
    assert.equal(
      bridgeRequests.filter(item => item === `POST /action/${bridgeAction}/up`).length,
      1,
      `${action} must preserve keyup`
    );
  }
  assert.ok(
    bridgeRequests.filter(item => item === "POST /focus").length >= 1,
    "Usage must focus Codex on keydown"
  );
  const usageState = messages.find(message =>
    message.cmd === "state" &&
    message.param?.statelist?.[0]?.uuid === usageEvent.uuid
  );
  const usageItem = usageState?.param?.statelist?.[0];
  assert.equal(usageItem?.type, 1);
  assert.equal(usageItem?.showtext, false);
  assert.equal(usageItem?.textData, "");
  assert.match(usageItem?.data || "", /^data:image\/svg\+xml;base64,/);
  const usageSvg = Buffer.from(usageItem.data.split(",")[1], "base64").toString();
  assert.match(usageSvg, />23<tspan/);
  assert.match(usageSvg, /#e89b2d/);

  const monitorEvent = {
    uuid: "com.ulanzi.ulanzistudio.codexmicro.taskmonitor",
    actionid: "action-monitor",
    key: "2_1",
    param: {}
  };
  client.send(JSON.stringify({ cmd: "add", ...monitorEvent }));
  client.send(JSON.stringify({ cmd: "keydown", ...monitorEvent }));
  client.send(JSON.stringify({ cmd: "run", ...monitorEvent }));
  client.send(JSON.stringify({ cmd: "keyup", ...monitorEvent }));
  await new Promise(resolve => setTimeout(resolve, 250));

  assert.equal(
    bridgeRequests.filter(item => item.includes("/thread/11111111-1111-1111-1111-111111111111/click?slot=0")).length,
    3,
    "Task Monitor press must open active thread"
  );
  const monitorState = messages.find(message =>
    message.cmd === "state" &&
    message.param?.statelist?.[0]?.uuid === monitorEvent.uuid
  );
  const monitorItem = monitorState?.param?.statelist?.[0];
  assert.equal(monitorItem?.type, 1);
  assert.equal(monitorItem?.showtext, false);
  assert.match(monitorItem?.data || "", /^data:image\/svg\+xml;base64,/);
  const monitorSvg = Buffer.from(monitorItem.data.split(",")[1], "base64").toString();
  assert.match(monitorSvg, /WORK/);
  assert.match(monitorSvg, /5\.6 LUNA/);
  assert.match(monitorSvg, /RUNNING/);

  const attentionEvent = {
    uuid: "com.ulanzi.ulanzistudio.codexmicro.attention",
    actionid: "action-attention",
    key: "2_2",
    param: {}
  };
  client.send(JSON.stringify({ cmd: "add", ...attentionEvent }));
  client.send(JSON.stringify({ cmd: "keydown", ...attentionEvent }));
  client.send(JSON.stringify({ cmd: "run", ...attentionEvent }));
  client.send(JSON.stringify({ cmd: "keyup", ...attentionEvent }));
  await new Promise(resolve => setTimeout(resolve, 250));

  const attentionState = messages.find(message =>
    message.cmd === "state" &&
    message.param?.statelist?.[0]?.uuid === attentionEvent.uuid
  );
  const attentionItem = attentionState?.param?.statelist?.[0];
  assert.equal(attentionItem?.type, 1);
  assert.equal(attentionItem?.showtext, false);
  assert.match(attentionItem?.data || "", /^data:image\/svg\+xml;base64,/);
  const attentionSvg = Buffer.from(attentionItem.data.split(",")[1], "base64").toString();
  assert.match(attentionSvg, />2</); // 2 pending: input task + error task

  // Slot zero belongs to another task; selected-task cards must remain unknown.
  const tokenEvent = { uuid: "com.ulanzi.ulanzistudio.codexmicro.tokens", actionid: "tokens-selected", key: "3_7", param: {} };
  client.send(JSON.stringify({ cmd: "add", ...tokenEvent }));
  await new Promise(resolve => setTimeout(resolve, 150));
  for (const [uuid, expected] of [[tokenEvent.uuid, /CONTEXT UNKNOWN/], [modelEvent.uuid, />Unknown</], [planEvent.uuid, />Open plan</]]) {
    const item = messages.find(message => message.cmd === "state" && message.param?.statelist?.[0]?.uuid === uuid)?.param?.statelist?.[0];
    assert.ok(item?.data, `Missing selected task card ${uuid}`);
    const svg = Buffer.from(item.data.split(',')[1], 'base64').toString();
    assert.match(svg, expected);
    assert.doesNotMatch(svg, /988k|5.6 LUNA/);
  }
  // Current Codex native slot states must update both task cards and the badge,
  // including clearing attention when the task resumes or completes.
  const latestSvg = uuid => {
    const item = messages.flatMap(message => message.cmd === "state" ? message.param?.statelist || [] : [])
      .filter(item => item.uuid === uuid && item.type === 1 && item.data).at(-1);
    return item ? Buffer.from(item.data.split(",")[1], "base64").toString() : "";
  };
  for (const action of ["approve", "reject"]) {
    assert.match(latestSvg(`com.ulanzi.ulanzistudio.codexmicro.${action}`), />NO PENDING</, "Unrelated input and error tasks must not advertise approval");
  }
  activeThreadKey = "local:11111111-1111-1111-1111-111111111111";
  for (const [status, color, count, label] of [
    ["awaiting-approval", "#f59e0b", 3, "waiting"],
    ["thinking", "#22c55e", 2, "thinking"],
    ["awaiting-response", "#f59e0b", 3, "waiting"],
    ["unread", "#3b82f6", 2, "done"]
  ]) {
    firstTaskStatus = status;
    const header = `height="38" fill="${color}"`;
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (latestSvg("com.ulanzi.ulanzistudio.codexmicro.task1").includes(header) &&
          latestSvg(navigateEvent.uuid).includes(header) &&
          latestSvg(attentionEvent.uuid).includes(`>${count}<`) &&
          latestSvg("com.ulanzi.ulanzistudio.codexmicro.approve").includes(status === "awaiting-approval" ? ">ACTION READY<" : ">NO PENDING<") &&
          latestSvg("com.ulanzi.ulanzistudio.codexmicro.reject").includes(status === "awaiting-approval" ? ">DENY REQUEST<" : ">NO PENDING<")) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    for (const uuid of ["com.ulanzi.ulanzistudio.codexmicro.task1", navigateEvent.uuid]) {
      assert.ok(latestSvg(uuid).includes(header), `${uuid} must render ${status} with ${color}`);
      assert.match(latestSvg(uuid), />2\/5</);
      assert.match(latestSvg(uuid), /Validate &lt;plan&gt;/);
      assert.match(latestSvg(uuid), new RegExp(`>${label}(?: |<)`));
    }
    assert.ok(latestSvg(attentionEvent.uuid).includes(`>${count}<`), `${status} must update the attention count`);
    assert.ok(latestSvg("com.ulanzi.ulanzistudio.codexmicro.approve").includes(status === "awaiting-approval" ? ">ACTION READY<" : ">NO PENDING<"), `${status} must update Approve`);
    assert.ok(latestSvg("com.ulanzi.ulanzistudio.codexmicro.reject").includes(status === "awaiting-approval" ? ">DENY REQUEST<" : ">NO PENDING<"), `${status} must update Reject`);
  }
  // Check the final host-visible update, rather than only finding an SVG that
  // could subsequently be overwritten by a manifest icon in the same batch.
  for (const message of messages.filter(message => message.cmd === "state")) {
    const items = message.param.statelist;
    for (const image of items.filter(item => item.type === 1)) {
      const last = items.findLast(item => item.uuid === image.uuid && item.actionid === image.actionid && item.key === image.key);
      assert.equal(last.data, image.data, `${image.uuid}: live display overwritten in the same batch`);
    }
  }
  process.stdout.write("Codex App plugin smoke test passed.\n");
} finally {
  child.kill("SIGTERM");
  host.close();
  bridge.close();
}
