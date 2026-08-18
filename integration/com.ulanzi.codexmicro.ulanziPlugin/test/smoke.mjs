import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";

const packageRootUrl = new URL("..", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("manifest.json", packageRootUrl)));
assert.match(manifest.Overview, /Ulanzi D200 Series/);
assert.match(manifest.Description, /INSTALLATION ENVIRONMENT/);
assert.match(manifest.Description, /LLM \/ AGENT INSTALLATION/);
assert.match(manifest.Description, /MANUAL INSTALLATION/);

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
  assert.match(messages.Description, /https:\/\/github\.com\/UlanziTechnology\/OpenCodexMicro/);
  assert.match(messages.Description, /npm run install:plugin/);
  assert.match(messages.Description, /npm run setup/);
}

const bridgeRequests = [];
const bridge = createServer((request, response) => {
  bridgeRequests.push(`${request.method} ${request.url}`);
  response.setHeader("Content-Type", "application/json");
  if (request.url === "/state") {
    response.end(JSON.stringify({
      connected: true,
      slots: [
        { id: 0, threadKey: "11111111-1111-1111-1111-111111111111", title: "Working task", status: "thinking" },
        { id: 1, threadKey: "22222222-2222-2222-2222-222222222222", title: "Unread task", status: "unread" },
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
    assert.equal(item?.type, 2);
    assert.equal(item?.path, taskPaths[index]);
    assert.equal(item?.showtext, true);
    assert.equal(Object.hasOwn(item || {}, "state"), false, "task icon update must not send a state index");
  }
  const task1State = messages.find(message =>
    message.cmd === "state" && message.param?.statelist?.[0]?.uuid.endsWith(".task1")
  );
  assert.equal(task1State?.param?.statelist?.[0]?.textdata, "Working task");

  client.send(JSON.stringify({ cmd: "keydown", uuid: "com.ulanzi.ulanzistudio.codexmicro.task1", actionid: "a1", key: "0_0", param: {} }));
  client.send(JSON.stringify({ cmd: "run", uuid: "com.ulanzi.ulanzistudio.codexmicro.task1", actionid: "a1", key: "0_0", param: {} }));
  client.send(JSON.stringify({ cmd: "keyup", uuid: "com.ulanzi.ulanzistudio.codexmicro.task1", actionid: "a1", key: "0_0", param: {} }));
  await new Promise(resolve => setTimeout(resolve, 150));
  const threadRequests = bridgeRequests.filter(item => item.includes("/thread/11111111-1111-1111-1111-111111111111/click?slot=0"));
  assert.equal(threadRequests.length, 1, "run must not duplicate a keydown task invocation");

  const actions = ["fast", "pin", "new", "fork", "steer", "mic", "submit"];
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
  assert.equal(usageItem?.showtext, false);
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
