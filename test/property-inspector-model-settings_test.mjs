import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const plugin = new URL("../integration/com.ulanzi.codexmicro.ulanziPlugin/", import.meta.url);
const html = await readFile(new URL("property-inspector/setup.html", plugin), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
const prefix = "com.ulanzi.ulanzistudio.codexmicro.";
const efforts = ["", "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];
const locales = ["en", "zh_CN", "zh_HK", "ja_JP", "de_DE", "ko_KR", "pt_PT", "es_ES"];

// Run the actual PI script, not a copied implementation. All IO is synthetic;
// the only resource read is a packaged locale. No Desktop, Bridge or API access.
async function inspector({ action = "model-sol-high", actionid = "key-context-A", key = "1", language = "en" } = {}) {
  const elements = new Map();
  for (const [, tag, attributes, id] of html.matchAll(/<([\w-]+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
    const listeners = new Map();
    let value = "";
    elements.set(id, {
      id, tag, disabled: /\bdisabled\b/.test(attributes), hidden: /\bhidden\b/.test(attributes),
      textContent: "", className: "", checked: false, placeholder: "", validationMessage: "",
      get value() { return value; },
      set value(next) { value = tag === "select" && id === "effort" && !efforts.includes(String(next)) ? "" : String(next); },
      set innerHTML(_) { assert.fail("PI must not use innerHTML"); },
      addEventListener(type, listener) { listeners.set(type, listener); },
      querySelector() { return { textContent: "" }; },
      setCustomValidity(message) { this.validationMessage = message; },
      emit(type, extra = {}) { listeners.get(type)?.({ target: this, ...extra }); },
    });
  }
  const sockets = [];
  class Socket {
    static OPEN = 1;
    readyState = 0;
    listeners = new Map();
    sent = [];
    constructor(url) { assert.equal(url, "ws://127.0.0.1:3906"); sockets.push(this); }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    send(raw) { this.sent.push(JSON.parse(raw)); }
    open() { this.readyState = 1; this.listeners.get("open")(); }
    message(value) { this.listeners.get("message")({ data: JSON.stringify(value) }); }
    close() { this.readyState = 3; this.listeners.get("close")(); }
  }
  const timers = [];
  const uuid = prefix + action;
  const context = vm.createContext({
    URLSearchParams, location: { search: new URLSearchParams({ uuid, actionid, key, language }).toString() },
    document: { getElementById(id) { assert.ok(elements.has(id), `Unknown element ${id}`); return elements.get(id); } },
    WebSocket: Socket, setInterval() { return 1; }, clearInterval() {},
    setTimeout(callback, delay) { assert.equal(delay, 1000); timers.push(callback); },
    console: new Proxy({}, { get() { return () => assert.fail("Settings must not enter logs"); } }),
    confirm() { return false; },
    async fetch(path) {
      assert.match(path, /^\.\.\/(en|zh_CN|zh_HK|ja_JP|de_DE|ko_KR|pt_PT|es_ES)\.json$/);
      return { async json() { return JSON.parse(await readFile(new URL(path.slice(3), plugin), "utf8")); } };
    },
  });
  vm.runInContext(script.replace("void start();", "globalThis.started = start();"), context);
  await context.started;
  const element = id => elements.get(id);
  return {
    element, sockets, timers, uuid, actionid, key,
    get socket() { return sockets.at(-1); },
    changes() { return sockets.flatMap(socket => socket.sent.filter(message => message.cmd === "setSettings")); },
    change(id, value, extra) { element(id).value = value; element(id).emit("change", extra); },
    restore(settings, envelope = {}) { this.socket.message({ cmd: "didReceiveSettings", settings, ...envelope }); },
  };
}

test("PI declares a free-text datalist, all efforts and disabled initial controls", () => {
  assert.match(html, /<input id="model"[^>]*type="text"[^>]*list="modelSuggestions"[^>]*maxlength="100"[^>]*disabled>/);
  assert.match(html, /<select id="effort"[^>]*disabled>/);
  const select = html.match(/<select id="effort"[\s\S]*?<\/select>/)[0];
  assert.deepEqual([...select.matchAll(/<option[^>]*value="([^"]*)"/g)].map(match => match[1]), efforts);
  assert.doesNotMatch(script, /innerHTML|\beval\s*\(|new Function/);
});

test("PI keeps all three UUID defaults and never saves before initial restoration", async () => {
  for (const [action, label, id, effort] of [
    ["model-sol-high", "5.6 Sol", "gpt-5.6-sol", "high"],
    ["model-luna-max", "5.6 Luna", "gpt-5.6-luna", "max"],
    ["model-sol-medium", "5.6 Sol", "gpt-5.6-sol", "medium"],
  ]) {
    const pi = await inspector({ action });
    assert.equal(pi.element("modelSettings").hidden, false);
    assert.equal(pi.element("model").disabled, true);
    assert.equal(pi.element("effort").disabled, true);
    assert.equal(pi.element("model").placeholder, label);
    assert.equal(pi.element("modelDefaults").textContent, `Defaults: ${label} (${id}) / ${effort}`);
    pi.socket.open();
    assert.deepEqual(pi.socket.sent.find(message => message.cmd === "getSettings"), {
      cmd: "getSettings", uuid: pi.uuid, actionid: pi.actionid, key: pi.key,
    });
    pi.change("model", "新模型");
    assert.equal(pi.changes().length, 0);
    pi.restore({});
    assert.equal(pi.element("model").disabled, false);
    assert.equal(pi.element("model").value, "");
    assert.equal(pi.element("effort").value, "");
    assert.equal(pi.changes().length, 0);
  }
});

test("non-model Actions hide controls and never request or save model settings", async () => {
  for (const action of ["task1", "fast", "model-sol-high-extra"]) {
    const pi = await inspector({ action });
    pi.socket.open(); pi.restore({ model: "5.6 Luna", effort: "max" });
    pi.change("model", "5.6 Sol");
    assert.equal(pi.element("modelSettings").hidden, true);
    assert.equal(pi.element("model").disabled, true);
    assert.equal(pi.socket.sent.some(message => /^(get|set)Settings$/.test(message.cmd)), false);
  }
});

test("per-context change saves exact names or ID aliases, preserves unrelated settings and blank defaults", async () => {
  const pi = await inspector(); pi.socket.open();
  pi.restore({ model: "5.6 Sol", effort: "high", custom: { color: "blue" }, forceFocus: true });
  for (const model of ["gpt-5.6-luna", "5.6 Luna", "中文 自定义模型-2.0", ""]) {
    pi.change("model", model);
    assert.deepEqual(pi.changes().at(-1), {
      cmd: "setSettings", uuid: pi.uuid, actionid: pi.actionid, key: pi.key,
      settings: { model, effort: "high", custom: { color: "blue" }, forceFocus: true },
    });
  }
  for (const effort of efforts) {
    pi.change("effort", effort);
    assert.equal(pi.changes().at(-1).settings.effort, effort);
  }
  assert.equal(pi.socket.sent.some(message => message.cmd === "setGlobalSettings"), false);
  pi.change("effort", "");
  const persisted = pi.changes().at(-1).settings;
  const reopened = await inspector(); reopened.socket.open(); reopened.restore(persisted);
  assert.equal(reopened.element("model").value, "");
  assert.equal(reopened.element("effort").value, "");
  assert.equal(reopened.changes().length, 0);
});

test("add and paramfromapp restore param, preserve other keys, and reject foreign contexts", async () => {
  const pi = await inspector(); pi.socket.open();
  pi.socket.message({ cmd: "add", uuid: pi.uuid, actionid: pi.actionid, key: pi.key, param: { model: "5.6 Luna", effort: "max", keep: 42 } });
  assert.equal(pi.element("model").value, "5.6 Luna");
  pi.socket.message({ cmd: "paramfromapp", param: { effort: "ultra" } });
  assert.equal(pi.element("model").value, "5.6 Luna");
  for (const envelope of [{ uuid: prefix + "model-sol-medium" }, { actionid: "other" }, { key: "2" }]) {
    pi.restore({ model: "wrong", effort: "low" }, envelope);
  }
  assert.equal(pi.element("effort").value, "ultra");
  pi.change("model", "另一模型");
  assert.deepEqual(pi.changes().at(-1).settings, { model: "另一模型", effort: "ultra", keep: 42 });
  const other = await inspector({ actionid: "key-context-B", key: "2" }); other.socket.open(); other.restore({});
  assert.equal(other.element("model").value, "");
  assert.equal(other.changes().length, 0);
});

test("invalid envelopes never unlock controls; global settings cannot restore action settings", async () => {
  const pi = await inspector(); pi.socket.open();
  for (const settings of [undefined, null, [], "bad", 0]) pi.restore(settings);
  pi.restore({}, { actionid: "another-key" });
  pi.socket.message({ cmd: "didReceiveGlobalSettings", settings: { model: "ignored", forceFocus: true } });
  pi.socket.listeners.get("message")({ data: "{" }); pi.socket.message(null);
  assert.equal(pi.element("model").disabled, true);
  assert.equal(pi.element("forceFocus").checked, true);
  assert.equal(pi.changes().length, 0);
});

test("validation blocks controls, code/HTML punctuation, overlength names; Chinese IME is not prematurely saved", async () => {
  const pi = await inspector(); pi.socket.open(); pi.restore({});
  for (const value of ["x\n", "x\r", "x\t", "x\0", "x\x7f", "x\x85", "x\u202e", "x".repeat(101), '<img src=x onerror="alert(1)">', "${alert(1)}", "`code`", "a';alert(1)//", "a\\b"]) {
    pi.change("model", value);
    assert.equal(pi.changes().length, 0);
    assert.ok(pi.element("modelError").textContent);
  }
  pi.change("model", "中文模型", { isComposing: true });
  assert.equal(pi.changes().length, 0);
  pi.change("model", "中文模型");
  assert.equal(pi.changes().at(-1).settings.model, "中文模型");
  pi.change("model", "字".repeat(100));
  assert.equal(pi.changes().at(-1).settings.model.length, 100);
});

test("invalid persisted fields cannot silently fall back when editing the other field", async () => {
  const pi = await inspector(); pi.socket.open();
  pi.restore({ model: "safe", effort: "unsupported", keep: 7 });
  assert.ok(pi.element("effort").validationMessage);
  pi.change("model", "新模型"); assert.equal(pi.changes().length, 0);
  pi.change("effort", "high"); assert.equal(pi.changes().length, 1);
  assert.equal(pi.changes().at(-1).settings.keep, 7);
  pi.restore({ model: { unexpected: true }, effort: "high", keep: 8 });
  pi.change("effort", "max"); assert.equal(pi.changes().length, 1);
  pi.change("model", "安全模型"); assert.equal(pi.changes().length, 2);
  assert.equal(pi.changes().at(-1).settings.keep, 8);
});

test("disconnect locks immediately, reconnect requests fresh settings before writes", async () => {
  const pi = await inspector(); pi.socket.open(); pi.restore({ model: "before", effort: "high", old: true });
  pi.socket.close();
  assert.equal(pi.element("model").disabled, true);
  assert.equal(pi.element("effort").disabled, true);
  pi.change("model", "offline"); assert.equal(pi.changes().length, 0);
  pi.timers.shift()(); pi.socket.open();
  assert.equal(pi.socket.sent.filter(message => message.cmd === "getSettings").length, 1);
  pi.change("model", "too soon"); assert.equal(pi.changes().length, 0);
  pi.restore({ model: "after", effort: "low", fresh: true });
  assert.equal(pi.element("model").value, "after");
  pi.change("effort", "medium");
  assert.deepEqual(pi.changes().at(-1).settings, { model: "after", effort: "medium", fresh: true });
});

test("all eight packaged locales supply and render the new UI strings", async () => {
  for (const language of locales) {
    const { Localization: strings } = JSON.parse(await readFile(new URL(`${language}.json`, plugin), "utf8"));
    for (const key of ["ModelSettingsTitle", "ModelLabel", "EffortLabel", "ModelHelp", "EffortHelp", "EffortDefault", "ModelDefaults", "ModelInvalid", "EffortInvalid", "ModelLoading"]) {
      assert.equal(typeof strings[key], "string", `${language}: ${key}`); assert.ok(strings[key]);
    }
    const pi = await inspector({ language });
    assert.equal(pi.element("modelSettingsTitle").textContent, strings.ModelSettingsTitle);
    assert.equal(pi.element("modelHelp").textContent, strings.ModelHelp);
    assert.equal(pi.element("effortHelp").textContent, strings.EffortHelp);
    assert.equal(pi.element("modelError").textContent, strings.ModelLoading);
  }
});

test("presetOption offers default model options and selecting one updates model and effort", async () => {
  const pi = await inspector(); pi.socket.open(); pi.restore({});
  assert.equal(pi.element("presetOption").disabled, false);

  const presets = [
    ["gpt-6-astra:low", "gpt-6-astra", "low"],
    ["gpt-6-astra:medium", "gpt-6-astra", "medium"],
    ["gemini-3.8-flash-high:high", "gemini-3.8-flash-high", "high"],
    ["gpt-5.6-sol:high", "gpt-5.6-sol", "high"]
  ];

  for (const [presetId, model, effort] of presets) {
    pi.change("presetOption", presetId);
    assert.equal(pi.element("model").value, model);
    assert.equal(pi.element("effort").value, effort);
    assert.deepEqual(pi.changes().at(-1).settings, { model, effort });
  }

  pi.restore({ model: "gpt-6-astra", effort: "low" });
  assert.equal(pi.element("presetOption").value, "gpt-6-astra:low");
});

test("gemini-3.8-flash-high locks effort to high and disables secondary effort control", async () => {
  const pi = await inspector(); pi.socket.open(); pi.restore({});
  pi.change("presetOption", "gemini-3.8-flash-high:high");
  assert.equal(pi.element("model").value, "gemini-3.8-flash-high");
  assert.equal(pi.element("effort").value, "high");
  assert.equal(pi.element("effort").disabled, true);

  // Switching to a model with multiple efforts unlocks the effort control
  pi.change("presetOption", "gpt-6-astra:low");
  assert.equal(pi.element("model").value, "gpt-6-astra");
  assert.equal(pi.element("effort").value, "low");
  assert.equal(pi.element("effort").disabled, false);
});
