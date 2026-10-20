import test from "node:test";
import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import { PassThrough } from "node:stream";
import { CodexCdpClient, modelPreset } from "../src/bridge/codex-cdp.mjs";
import { modelPickerExpression } from "../src/bridge/model-picker.mjs";
import { modelSelectionMatches, modelDisplayLabel, DEFAULT_MODEL_OPTIONS } from "../src/bridge/model-selection.mjs";
import { readModelSettings } from "../src/bridge/model-request.mjs";

// A small DOM fixture: production expressions and event dispatch execute as-is.
// No stage-name mocks that pretend the missing legacy submenu rows exist.
class Element {
  constructor(tag, attrs = {}, text = "", onClick = null) {
    this.tag = tag;
    this.attrs = { ...attrs };
    this.text = text;
    this.children = [];
    this.offsetParent = {};
    this.onClick = onClick;
  }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(" "); }
  get children() { return this._children; }
  set children(value) { this._children = value; for (const child of value) child.parentElement = this; }
  get disabled() { return this.hasAttribute("disabled"); }
  getAttribute(name) { return this.attrs[name] ?? null; }
  hasAttribute(name) { return Object.hasOwn(this.attrs, name); }
  getBoundingClientRect() { return this.offsetParent === null ? { width: 0, height: 0 } : { width: 200, height: 30 }; }
  contains(other) { return this.children.some(child => child === other || child.contains(other)); }
  matches(selector) {
    return selector.split(",").some(part => {
      const tag = part.match(/^[a-z]+/i)?.[0];
      if (tag && tag !== this.tag) return false;
      return [...part.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)]
        .every(([, name, value]) => value === undefined ? this.hasAttribute(name) : this.getAttribute(name) === value);
    });
  }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [
      ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)
    ]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  focus() {}
  dispatchEvent(event) {
    if (event.type === "click") this.onClick?.();
    if (event.type === "keydown") this.onKeyDown?.(event);
    return true;
  }
}

function pickerFixture({ currentModel = "5.6 Sol", currentEffort = "high",
  targetModel = "5.6 Sol", efforts = ["low", "medium", "high"],
  duplicateModel = false, duplicateEffort = false, disabledEffort = false, commit = true,
  immediateModel = false } = {}) {
  const doc = new Element("document");
  const events = [];
  const trigger = new Element("button", { "data-codex-intelligence-trigger": "", "aria-controls": "picker",
    "aria-expanded": "false", "data-selected-reasoning-effort": currentEffort }, currentModel);
  const menu = new Element("div", { role: "menu", id: "picker", "data-state": "closed" });
  const option = (label, attrs, click) => {
    const item = new Element("div", { role: "menuitemradio", ...attrs }, "", click);
    item.children = [new Element("span", {}, label), new Element("span", {}, "Description")];
    return item;
  };
  const showEfforts = () => {
    events.push("model");
    if (immediateModel) trigger.text = targetModel;
    menu.children = [...efforts, ...(duplicateEffort ? ["medium"] : [])].map(effort =>
      option(effort, disabledEffort && effort === "medium" ? { "aria-disabled": "true" } : {}, () => {
        events.push("effort");
        if (commit) {
          trigger.text = targetModel;
          trigger.attrs["data-selected-reasoning-effort"] = effort;
        }
        trigger.attrs["aria-expanded"] = "false";
        menu.attrs["data-state"] = "closed";
      }));
  };
  const showModels = () => {
    events.push("picker");
    // No aria-haspopup rows and no legacy toggle/slider after navigation.
    menu.children = [option(targetModel, {}, showEfforts)];
    if (duplicateModel) menu.children.push(option(targetModel, {}, showEfforts));
  };
  trigger.onClick = () => {
    events.push("open");
    trigger.attrs["aria-expanded"] = "true";
    menu.attrs["data-state"] = "open";
    menu.children = [new Element("button", { "data-model-picker-view-toggle": "", "aria-expanded": "false" }, "Models", showModels)];
  };
  doc.children = [trigger, menu];
  doc.getElementById = id => doc.querySelectorAll("[id]").find(item => item.getAttribute("id") === id) || null;
  doc.dispatchEvent = event => {
    if (event.key === "Escape") {
      events.push("escape");
      trigger.attrs["aria-expanded"] = "false";
      menu.attrs["data-state"] = "closed";
    }
  };
  class Event { constructor(type, init) { this.type = type; Object.assign(this, init); } }
  const client = new CodexCdpClient();
  client.evaluate = async expression => runInNewContext(expression, {
    document: doc, window: {}, MouseEvent: Event, PointerEvent: Event, KeyboardEvent: Event
  });
  return { client, trigger, menu, doc, events, showModels };
}

test("sequential picker fixes same-model high to medium with no submenu rows", async () => {
  const fixture = pickerFixture();
  await fixture.client.dispatchModelPreset("model-sol-medium");
  assert.deepEqual(fixture.events, ["open", "picker", "model", "effort"]);
  assert.equal(fixture.trigger.getAttribute("data-selected-reasoning-effort"), "medium");
});

test("sequential picker waits until effort commits the new model", async () => {
  const fixture = pickerFixture({ targetModel: "5.6 Luna", efforts: ["medium", "high", "max"] });
  await fixture.client.dispatchModelPreset("model-luna-max");
  assert.equal(fixture.trigger.textContent, "5.6 Luna");
  assert.equal(fixture.trigger.getAttribute("data-selected-reasoning-effort"), "max");
  assert.deepEqual(fixture.events, ["open", "picker", "model", "effort"]);
});

test("custom model label and model-specific subset of efforts", async () => {
  const fixture = pickerFixture({ targetModel: "Custom Model", efforts: ["minimal", "high"], immediateModel: true });
  await fixture.client.dispatchModelPreset("model-sol-high", null, { model: "Custom Model", effort: "minimal" });
  assert.equal(fixture.trigger.textContent, "Custom Model");
  assert.equal(fixture.trigger.getAttribute("data-selected-reasoning-effort"), "minimal");
});

test("already selected model and effort does not open a menu", async () => {
  const fixture = pickerFixture();
  await fixture.client.dispatchModelPreset("model-sol-high");
  assert.deepEqual(fixture.events, []);
});

for (const [name, options] of [
  ["unavailable effort", { efforts: ["low", "high"] }],
  ["duplicate effort", { duplicateEffort: true }],
  ["disabled effort", { disabledEffort: true }],
  ["duplicate model", { duplicateModel: true }]
]) {
  test(`sequential picker rejects ${name} and cleans up`, async () => {
    const fixture = pickerFixture(options);
    await assert.rejects(fixture.client.dispatchModelPreset("model-sol-medium"), /unavailable|ambiguous|Expected one/);
    assert.equal(fixture.events.includes("effort"), false);
    assert.equal(fixture.trigger.getAttribute("aria-expanded"), "false");
  });
}

test("no success or replay when final model/effort did not change", async () => {
  const fixture = pickerFixture({ commit: false });
  await assert.rejects(fixture.client.dispatchModelPreset("model-sol-medium"), /Timed out/);
  assert.equal(fixture.events.filter(event => event === "effort").length, 1);
});

test("picker ignores unrelated menus and hidden duplicate triggers", async () => {
  const fixture = pickerFixture();
  fixture.trigger.onClick();
  fixture.showModels();
  const hidden = new Element("button", { "data-codex-intelligence-trigger": "" }, "Hidden");
  hidden.offsetParent = null;
  const unrelated = new Element("div", { role: "menu", "data-state": "open" });
  unrelated.children = [new Element("button", {}, "5.6 Sol")];
  fixture.doc.children.push(hidden, unrelated);
  const snapshot = await fixture.client.evaluate(modelPickerExpression(modelPreset("model-sol-medium")));
  assert.equal(snapshot.modelCount, 1);
});

test("a legacy row labelled with the current model is not a model choice", async () => {
  const fixture = pickerFixture();
  fixture.trigger.onClick();
  fixture.menu.children = [new Element("div", { role: "menuitem", "aria-haspopup": "menu" }, "5.6 Sol")];
  const snapshot = await fixture.client.evaluate(modelPickerExpression(modelPreset("model-sol-medium")));
  assert.equal(snapshot.modern, false);
});

test("an already open model view needs no legacy toggle or slider marker", async () => {
  const fixture = pickerFixture();
  fixture.trigger.onClick();
  fixture.showModels();
  fixture.events.length = 0;
  await fixture.client.dispatchModelPreset("model-sol-medium");
  assert.deepEqual(fixture.events, ["model", "effort"]);
});

// Codex 26.901.6511.0 / 2026-09-07: model list and simple power
// panel coexist in separate aria-hidden/inert tracks, not nested menus.
function sliderFixture({ efforts = ["medium", "high", "xhigh"], current = "medium",
  commit = true, locked = null, malformed = false, duplicate = false, disabled = false,
  model = "gpt-5.6-sol", label = "5.6 Sol" } = {}) {
  const fixture = pickerFixture({ currentModel: "Other Model", currentEffort: current });
  const { menu, trigger, events } = fixture;
  const modelView = new Element("div");
  const powerView = new Element("div", { "aria-hidden": "true", inert: "" });
  const slider = new Element("div", {
    role: "menuitem", "data-reasoning-slider": "", "aria-label": "功率",
    "aria-keyshortcuts": "ArrowLeft ArrowRight", ...(disabled ? { "data-disabled": "" } : {})
  });
  const options = efforts.map(effort => ({ id: `${model}:${effort}`, label: "本地化等级", isLocked: effort === locked }));
  let selected = `${model}:${current}`;
  const render = () => {
    slider.__reactProps$fixture = { children: { props: { children: [
      { props: { options, selectedOptionId: selected, active: true, disabled } }
    ] } } };
    if (malformed) delete slider.__reactProps$fixture;
  };
  render();
  slider.onKeyDown = event => {
    events.push(event.key);
    if (!commit) return;
    const index = options.findIndex(option => option.id === selected);
    selected = options[index + (event.key === "ArrowRight" ? 1 : -1)].id;
    trigger.attrs["data-selected-reasoning-effort"] = selected.slice(selected.lastIndexOf(":") + 1);
    render();
  };
  const toggle = new Element("button", { "data-model-picker-view-toggle": "" }, label, () => {
    modelView.attrs = {};
    powerView.attrs = { "aria-hidden": "true", inert: "" };
  });
  powerView.children = [toggle, slider];
  if (duplicate) powerView.children = [toggle, slider, new Element("div", { "data-reasoning-slider": "" })];
  const modelOption = new Element("div", { role: "menuitemradio" }, label, () => {
    events.push("model");
    modelView.attrs = { "aria-hidden": "true", inert: "" };
    powerView.attrs = {};
    trigger.text = "中"; // Trigger no longer contains a model name.
  });
  modelView.children = [modelOption];
  trigger.onClick = () => {
    events.push("open");
    menu.attrs["data-state"] = "open";
    trigger.attrs["aria-expanded"] = "true";
    menu.children = [modelView, powerView];
  };
  return { ...fixture, slider, options, modelView, powerView };
}

test("model list transitions to localized slider panel and selects high", async () => {
  const fixture = sliderFixture();
  await fixture.client.dispatchModelPreset("model-sol-high");
  assert.deepEqual(fixture.events, ["open", "model", "ArrowRight", "escape"]);
  assert.equal(fixture.trigger.getAttribute("data-selected-reasoning-effort"), "high");
});

test("slider supports multi-step decrease using actual model-specific choices", async () => {
  const fixture = sliderFixture({ current: "xhigh" });
  await fixture.client.dispatchModelPreset("model-sol-medium");
  assert.deepEqual(fixture.events, ["open", "model", "ArrowLeft", "ArrowLeft", "escape"]);
});

test("current slider model is used even when trigger shows only localized effort", async () => {
  const fixture = sliderFixture();
  fixture.trigger.onClick();
  fixture.modelView.attrs = { "aria-hidden": "true", inert: "" };
  fixture.powerView.attrs = {};
  fixture.trigger.text = "中";
  fixture.events.length = 0;
  await fixture.client.dispatchModelPreset("model-sol-high");
  assert.deepEqual(fixture.events, ["ArrowRight", "escape"]);
});

test("known display-name aliases resolve to slider model ids", async () => {
  const fixture = sliderFixture({ model: "gpt-reserve", label: "Luna Reserve", efforts: ["medium", "high", "max"] });
  await fixture.client.dispatchModelPreset("model-sol-high", null, { model: "Luna Reserve", effort: "max" });
  assert.deepEqual(fixture.events, ["open", "model", "ArrowRight", "ArrowRight", "escape"]);
});

for (const [name, options, target] of [
  ["missing metadata", { malformed: true }, "high"],
  ["duplicate slider", { duplicate: true }, "high"],
  ["disabled slider", { disabled: true }, "high"],
  ["unsupported effort", {}, "max"],
  ["locked intermediate", { locked: "high" }, "xhigh"]
]) {
  test(`slider fails closed: ${name}`, async () => {
    const fixture = sliderFixture(options);
    await assert.rejects(fixture.client.dispatchModelPreset("model-sol-high", null, { effort: target }),
      /unavailable|ambiguous|disabled|locked/);
    assert.equal(fixture.events.some(event => event.startsWith("Arrow")), false);
  });
}

test("unconfirmed slider step is not replayed", async () => {
  const fixture = sliderFixture({ commit: false });
  await assert.rejects(fixture.client.dispatchModelPreset("model-sol-high"), /Timed out/);
  assert.equal(fixture.events.filter(event => event === "ArrowRight").length, 1);
  assert.equal(fixture.trigger.getAttribute("aria-expanded"), "false");
});

test("slider refuses a path that would select a different model", async () => {
  const fixture = sliderFixture();
  fixture.options[1].id = "another-model:high";
  await assert.rejects(fixture.client.dispatchModelPreset("model-sol-high", null, { effort: "xhigh" }), /another model/);
  assert.equal(fixture.events.some(event => event.startsWith("Arrow")), false);
});

test("custom settings are validated, defaulted and frozen without substring matching", () => {
  assert.equal(modelPreset("model-sol-high", { model: "", effort: "" }).effort, "high");
  const custom = modelPreset("model-sol-high", { model: " Custom Model ", effort: "ultra" });
  assert.ok(Object.isFrozen(custom));
  assert.equal(custom.displayName, "Custom Model");
  assert.equal(modelSelectionMatches("Custom Model ultra", custom), true);
  assert.equal(modelSelectionMatches("Custom Model Pro", custom), false);
  assert.equal(modelSelectionMatches("GPT-5.6 Sol high", modelPreset("model-sol-high")), true);
  for (const settings of [null, [], { model: 1 }, { model: "bad\nmodel" },
    { model: "<script>" }, { model: "`" }, { model: "${unsafe}" },
    { model: "x".repeat(101) }, { effort: "guess" }]) {
    assert.throws(() => modelPreset("model-sol-high", settings), /Invalid/);
  }
});

test("model overrides reach the serialized action without keyup replay", async () => {
  const client = new CodexCdpClient();
  client.connect = async () => {};
  const selected = [];
  client.dispatchModelPreset = async (_action, _trace, preset) => selected.push(preset);
  const settings = { model: "Custom Model", effort: "low" };
  const pending = client.dispatchNamedAction("model-sol-high", true, null, settings);
  settings.model = "Changed after keydown";
  await pending;
  await client.dispatchNamedAction("model-sol-high", false, null, settings);
  assert.equal(selected.length, 1);
  assert.equal(selected[0].model, "Custom Model");
  await assert.rejects(client.dispatchNamedAction("model-sol-high", true, null, { effort: "unknown" }), /Invalid/);
});

test("bounded model request reader accepts old empty bodies and rejects invalid input", async () => {
  for (const [body, expected] of [["", undefined], ['{"model":"Custom Model","effort":"low"}', { model: "Custom Model", effort: "low" }]]) {
    const request = new PassThrough();
    const result = readModelSettings(request);
    request.end(body);
    assert.deepEqual(await result, expected);
  }
  for (const body of ["{", "[]", "null", '{"extra":true}', "x".repeat(2049)]) {
    const request = new PassThrough();
    const result = readModelSettings(request);
    request.end(body);
    await assert.rejects(result, error => error.statusCode === 400);
  }
  const slow = new PassThrough();
  await assert.rejects(readModelSettings(slow, { timeoutMs: 5 }), /timed out/);
  slow.destroy();
});

test("modelDisplayLabel provides distinct names for all default model options", () => {
  assert.equal(DEFAULT_MODEL_OPTIONS.length, 4);
  assert.equal(modelDisplayLabel({ model: "gpt-6-astra", effort: "low" }), "ASTRA LOW");
  assert.equal(modelDisplayLabel({ model: "gpt-6-astra", effort: "medium" }), "ASTRA MED");
  assert.equal(modelDisplayLabel(DEFAULT_MODEL_OPTIONS[2]), "GEMINI MED");
  assert.deepEqual(DEFAULT_MODEL_OPTIONS[2], { model: "gemini-3.8-flash-high", effort: "medium", label: "GEMINI MED" });
  assert.equal(modelDisplayLabel({ model: "gemini-3.8-flash-high", effort: "high" }), "GEMINI HIGH");
  assert.equal(modelDisplayLabel({ model: "gpt-5.6-sol", effort: "high" }), "SOL HIGH");

  // Case-insensitive and alias matching
  assert.equal(modelDisplayLabel({ model: "GPT-6 Astra", effort: "low" }), "ASTRA LOW");
  assert.equal(modelDisplayLabel({ model: "Gemini 3.8 Flash High", effort: "high" }), "GEMINI HIGH");
  assert.equal(modelDisplayLabel({ model: "gemini-3.8-flash", effort: "medium" }), "GEMINI MED");
  assert.equal(modelDisplayLabel({ model: "5.6 Sol", effort: "high" }), "SOL HIGH");

  // Other recognized models
  assert.equal(modelDisplayLabel({ model: "gpt-5.6-sol", effort: "medium" }), "SOL MED");
  assert.equal(modelDisplayLabel({ model: "gpt-5.6-luna", effort: "max" }), "LUNA MAX");

  // Unknown / arbitrary custom models fall back to CUSTOM MODEL
  assert.equal(modelDisplayLabel({ model: "Custom Model", effort: "low" }), "CUSTOM MODEL");
  assert.equal(modelDisplayLabel({ model: "unknown-ai", effort: "high" }), "CUSTOM MODEL");
  assert.equal(modelDisplayLabel(null), "CUSTOM MODEL");
});

for (const model of ["gemini-3.8-flash-high", "gemini-3.8-flash", "Gemini 3.8 Flash High"]) {
  test(`Flash alias ${model} keeps the API id and defaults to medium`, () => {
    const preset = modelPreset("model-sol-high", { model });
    assert.deepEqual(preset, { model: "gemini-3.8-flash-high", displayName: "gemini-3.8-flash", effort: "medium" });
    assert.equal(modelPreset("model-sol-high", { model, effort: "" }).effort, "medium");
    assert.equal(modelPreset("model-sol-high", { model, effort: "high" }).effort, "high");
    for (const label of ["gemini-3.8-flash", "gemini-3.8-flash-high", "Gemini 3.8 Flash High", "gemini-3.8-flash medium"]) {
      assert.equal(modelSelectionMatches(label, preset), true);
    }
    assert.equal(modelSelectionMatches("gemini-3.8-flash-lite", preset), false);
  });

  for (const [current, target] of [["high", "medium"], ["medium", "high"]]) {
    test(`Flash ${model} sequential picker changes ${current} to ${target}`, async () => {
      const fixture = pickerFixture({ currentModel: "gemini-3.8-flash", targetModel: "gemini-3.8-flash",
        currentEffort: current, efforts: ["medium", "high"] });
      const result = await fixture.client.dispatchModelPreset("model-sol-high", null, { model, effort: target });
      assert.deepEqual(result, { model: "gemini-3.8-flash-high", effort: target });
      assert.equal(fixture.trigger.getAttribute("data-selected-reasoning-effort"), target);
      assert.deepEqual(fixture.events, ["open", "picker", "model", "effort"]);
    });
  }
}

for (const model of ["gemini-3.8-flash-high", "gemini-3.8-flash"]) {
  for (const [current, target, arrow] of [["high", "medium", "ArrowLeft"], ["medium", "high", "ArrowRight"]]) {
    test(`Flash slider ${model} changes ${current} to ${target}`, async () => {
      const fixture = sliderFixture({ model, label: "gemini-3.8-flash", efforts: ["medium", "high"], current });
      await fixture.client.dispatchModelPreset("model-sol-high", null, { model: "gemini-3.8-flash", effort: target });
      assert.deepEqual(fixture.events, ["open", "model", arrow, "escape"]);
      assert.equal(fixture.trigger.getAttribute("data-selected-reasoning-effort"), target);
    });
  }
}

test("Flash cannot report success with an unconfirmed reasoning effort", async () => {
  const fixture = pickerFixture({ currentModel: "gemini-3.8-flash", targetModel: "gemini-3.8-flash",
    currentEffort: null, efforts: ["high"] });
  await assert.rejects(fixture.client.dispatchModelPreset("model-sol-high", null, { model: "gemini-3.8-flash" }), /unavailable/);
  assert.equal(fixture.events.includes("effort"), false);
  assert.equal(fixture.trigger.getAttribute("aria-expanded"), "false");
});

test("other Gemini models still select without a secondary effort menu", async () => {
  const doc = new Element("document");
  const events = [];
  const trigger = new Element("button", {
    "data-codex-intelligence-trigger": "", "aria-controls": "picker",
    "aria-expanded": "false", "data-selected-reasoning-effort": "high"
  }, "5.6 Sol");
  const menu = new Element("div", { role: "menu", id: "picker", "data-state": "closed" });
  const option = (label, attrs, click) => {
    const item = new Element("div", { role: "menuitemradio", ...attrs }, "", click);
    item.children = [new Element("span", {}, label), new Element("span", {}, "Description")];
    return item;
  };
  const selectGemini = () => {
    events.push("model");
    trigger.text = "gemini-3.8-pro-high";
    trigger.attrs["data-selected-reasoning-effort"] = "high";
    trigger.attrs["aria-expanded"] = "false";
    menu.attrs["data-state"] = "closed";
    menu.children = [];
  };
  const showModels = () => {
    events.push("picker");
    menu.children = [option("gemini-3.8-pro-high", {}, selectGemini)];
  };
  trigger.onClick = () => {
    events.push("open");
    trigger.attrs["aria-expanded"] = "true";
    menu.attrs["data-state"] = "open";
    menu.children = [new Element("button", { "data-model-picker-view-toggle": "", "aria-expanded": "false" }, "Models", showModels)];
  };
  doc.children = [trigger, menu];
  doc.getElementById = id => doc.querySelectorAll("[id]").find(item => item.getAttribute("id") === id) || null;

  class Event { constructor(type, init) { this.type = type; Object.assign(this, init); } }
  const client = new CodexCdpClient();
  client.evaluate = async expression => runInNewContext(expression, {
    document: doc, window: {}, MouseEvent: Event, PointerEvent: Event, KeyboardEvent: Event
  });

  await client.dispatchModelPreset("model-sol-high", null, { model: "gemini-3.8-pro-high", effort: "high" });
  assert.equal(trigger.text, "gemini-3.8-pro-high");
  assert.equal(events.includes("model"), true);
  assert.equal(events.includes("effort"), false);
});
